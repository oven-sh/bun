//! <https://html.spec.whatwg.org/#webstorage>

use core::mem::ManuallyDrop;

use bun_alloc::WTFStringImplStruct;
use bun_collections::{ArrayHashMap, HashMap};
use bun_jsc::Weak;
use bun_jsc::bindgen::{ClassStructure, PropertyNames};
use bun_markup::Chars;
use bun_web::net::session::Session;
use bun_web::realm::Realm;
use bun_web::storage::areas::{Borrower, Changed, Items, Whose};
use bun_web::storage::{AreaChange, Origins, Storage};

use super::*;
use crate::api::window::Window;
use crate::generated_bindgen::window::js_DomWindow;

/// In code units.
const MAX_SIZE: usize = 5 << 20;

#[derive(Clone)]
enum Owner {
    Profile(Arc<Storage>),
    /// With the frames in it.
    Tab(u32),
}

impl PartialEq for Owner {
    fn eq(&self, other: &Owner) -> bool {
        match (self, other) {
            (Owner::Profile(a), Owner::Profile(b)) => Arc::ptr_eq(a, b),
            (Owner::Tab(a), Owner::Tab(b)) => a == b,
            _ => false,
        }
    }
}

#[derive(Default)]
struct Area {
    owner: Option<Owner>,
    bucket: Box<[u8]>,
    items: RefCell<ArrayHashMap<Atom, DomString>>,
    size: Cell<usize>,
    borrowed: Option<RefCell<Borrowed>>,
}

/// From the host.
#[derive(Default)]
struct Borrowed {
    version: u64,
    last_change: u64,
    /// The numbers of the changes that the host may have yet to hear of.
    last_clearing: u64,
    last_changes: HashMap<Atom, u64>,
}

/// A process that may have a copy.
struct Watcher {
    peer: u32,
    whose: Whose,
    owner: Owner,
    bucket: Box<[u8]>,
    applied: u64,
}

#[derive(Default)]
struct Shared {
    watchers: Vec<Watcher>,
    version: u64,
    areas: Vec<Rc<Area>>,
    listening_windows: Vec<Weak<()>>,
}

thread_local! {
    static SHARED: ManuallyDrop<RefCell<Shared>> = {
        extern "C" fn forget(_: *mut core::ffi::c_void) {
            drop(with_shared(core::mem::take));
        }
        bun_web::exec::at_exit(forget);
        ManuallyDrop::default()
    };
}

fn with_shared<R>(steps: impl FnOnce(&mut Shared) -> R) -> R {
    SHARED.with(|it| steps(&mut it.borrow_mut()))
}

fn to_utf16le(text: Chars<'_>) -> Box<[u8]> {
    match text {
        Chars::Latin1(it) => it.iter().flat_map(|it| [*it, 0]).collect(),
        Chars::Utf16(it) => it.iter().flat_map(|it| it.to_le_bytes()).collect(),
    }
}

fn from_utf16le(bytes: &[u8]) -> Vec<u16> {
    bytes
        .as_chunks()
        .0
        .iter()
        .map(|it| u16::from_le_bytes(*it))
        .collect()
}

fn forget(profile: &Storage, origins: &Origins) {
    let is_meant = |it: &&Rc<Area>| {
        matches!(&it.owner, Some(Owner::Profile(it)) if core::ptr::eq(Arc::as_ptr(it), profile))
            && origins.include(&it.bucket)
    };
    let meant = with_shared(|it| {
        it.areas
            .iter()
            .filter(is_meant)
            .cloned()
            .collect::<Vec<_>>()
    });
    for it in meant {
        it.empty();
        it.tell_watchers(None, || AreaChange::Clear, None, None);
    }
}

fn atom_of(bytes: &[u8]) -> Atom {
    Atom::from_chars(Chars::Utf16(&from_utf16le(bytes)))
}

fn string_of(bytes: &[u8]) -> DomString {
    DomString::from_chars(Chars::Utf16(&from_utf16le(bytes)))
}

impl Area {
    fn find(owner: &Owner, bucket: &[u8]) -> Option<Rc<Area>> {
        with_shared(|it| {
            it.areas
                .iter()
                .find(|it| it.owner.as_ref() == Some(owner) && *it.bucket == *bucket)
                .cloned()
        })
    }

    fn share(self) -> Rc<Area> {
        let area = Rc::new(self);
        with_shared(|it| it.areas.push(Rc::clone(&area)));
        area
    }

    fn of(owner: Owner, bucket: &[u8]) -> Rc<Area> {
        Area::find(&owner, bucket).unwrap_or_else(|| {
            let area = Area {
                owner: Some(owner),
                bucket: bucket.into(),
                ..Default::default()
            };
            if let Some(Owner::Profile(profile)) = &area.owner {
                profile.read_area(bucket, forget, |key, value| area.add(key, value));
            }
            area.share()
        })
    }

    fn for_client(owner: Owner, client: &Client) -> Rc<Area> {
        let bucket = client.bucket();
        Area::find(&owner, &bucket).unwrap_or_else(|| {
            let Some(items) = client.borrow_area(matches!(owner, Owner::Profile(_))) else {
                return Area::of(owner, &bucket);
            };
            let borrowed = Borrowed {
                version: items.version,
                ..Default::default()
            };
            let area = Area {
                owner: Some(owner),
                bucket: bucket.into(),
                borrowed: Some(borrowed.into()),
                ..Default::default()
            };
            items.each(|key, value| area.add(key, value));
            area.share()
        })
    }

    fn add(&self, key: &[u8], value: &[u8]) {
        self.size.update(|it| it + (key.len() + value.len()) / 2);
        self.items
            .borrow_mut()
            .insert(atom_of(key), string_of(value));
    }

    fn size_with(&self, key: &Atom, old_value: Option<&DomString>, value: &DomString) -> usize {
        old_value.map_or_else(
            || self.size.get() + key.chars().len(),
            |old| self.size.get() - old.len() as usize,
        ) + value.len() as usize
    }

    fn remove(&self, key: &Atom) -> Option<DomString> {
        let (_, old_value) = self.items.borrow_mut().fetch_swap_remove(key)?;
        self.size
            .update(|it| it - key.chars().len() - old_value.len() as usize);
        Some(old_value)
    }

    fn tell_watchers(
        &self,
        except: Option<u32>,
        change: impl Fn() -> AreaChange,
        old_value: Option<&DomString>,
        url: Option<&[u8]>,
    ) {
        with_shared(|shared| {
            shared.version += 1;
            for it in shared.watchers.iter().filter(|it| {
                Some(it.peer) != except
                    && Some(&it.owner) == self.owner.as_ref()
                    && it.bucket == self.bucket
            }) {
                let (old_value, url) = (
                    old_value.map(|it| to_utf16le(it.chars())),
                    url.map(Into::into),
                );
                Changed {
                    whose: it.whose,
                    bucket: it.bucket.clone(),
                    change: Some(change()),
                    old_value,
                    url,
                    version: shared.version,
                    applied: it.applied,
                }
                .send(it.peer);
            }
        });
    }

    /// <https://html.spec.whatwg.org/#concept-storage-broadcast>, in this process.
    fn broadcast(
        &self,
        heap: &JsHeap<'_>,
        except: Option<&Window>,
        url: impl Fn() -> Option<DomString>,
        key: Option<&Atom>,
        old_value: Option<&DomString>,
        new_value: Option<&DomString>,
    ) {
        let Some(owner) = &self.owner else { return };
        let is_local = matches!(owner, Owner::Profile(_));
        for at in 0.. {
            let Some(window) = with_shared(|it| it.listening_windows.get(at).map(Weak::get)) else {
                return;
            };
            let Some(window) = window
                .and_then(|it| Window::from_js(heap, it))
                .filter(|it| except.is_none_or(|own| it.to_js() != own.to_js()))
            else {
                continue;
            };
            let shares = client_of_window(window).is_some_and(|it| {
                owner_for(window, &it, is_local) == *owner && *it.bucket() == *self.bucket
            });
            let (true, Some(doc), Some(url)) = (shares, window.doc(), url()) else {
                continue;
            };
            let change = Change {
                key: key.map(Atom::to_dom_string),
                old_value: old_value.cloned(),
                new_value: new_value.cloned(),
                url,
            };
            queue_task(doc.heap(heap), [window.to_js()], move |cx, [window]| {
                let Some(window) = Window::from_js(&cx.heap, window.to_js()) else {
                    return;
                };
                let base = Event::base(atom!("storage"), EventInit::default(), Trusted::Yes);
                let event = js_StorageEvent::create(
                    &cx.heap,
                    StorageEvent {
                        base,
                        fields: Default::default(),
                        change: change.into(),
                    },
                );
                js_StorageEvent::set_storage_area(
                    event,
                    storage_of(&cx.heap, window, is_local).ok(),
                );
                dispatch(cx, window, event);
            });
        }
    }

    fn empty(&self) {
        self.items.take();
        self.size.set(0);
    }

    fn keep(&self, change: impl Fn() -> AreaChange) {
        if let Some(Owner::Profile(profile)) = &self.owner
            && profile.is_persistent()
        {
            profile.change_area(&self.bucket, change());
        }
    }
}

#[unsafe(export_name = "__bun_dom_copy_session_storage")]
fn copy_session_storage(from: u32, to: u32, bucket: &[u8]) {
    if let Some(it) = Area::find(&Owner::Tab(from), bucket) {
        let items = RefCell::new(bun_core::handle_oom(it.items.borrow().clone()));
        Area {
            owner: Some(Owner::Tab(to)),
            bucket: bucket.into(),
            items,
            size: it.size.clone(),
            borrowed: None,
        }
        .share();
    }
}

#[unsafe(export_name = "__bun_dom_drop_session_storage")]
fn drop_session_storage(tab: u32) {
    with_shared(|it| {
        it.areas.retain(|it| it.owner != Some(Owner::Tab(tab)));
        it.watchers.retain(|it| it.whose != Whose::Tab(tab));
    });
}

fn owner_lent_to(it: &Borrower) -> Owner {
    match it.whose {
        Whose::Session(_) => Owner::Profile(Arc::clone(&it.storage)),
        Whose::Tab(tab) => Owner::Tab(tab),
    }
}

fn with_watcher<R>(by: &Borrower, steps: impl FnOnce(&mut Watcher) -> R) -> R {
    with_shared(|shared| {
        let at = shared
            .watchers
            .iter()
            .position(|it| (it.peer, it.whose) == (by.peer, by.whose) && *it.bucket == *by.bucket)
            .unwrap_or_else(|| {
                shared.watchers.push(Watcher {
                    peer: by.peer,
                    whose: by.whose,
                    owner: owner_lent_to(by),
                    bucket: by.bucket[..].into(),
                    applied: 0,
                });
                shared.watchers.len() - 1
            });
        steps(&mut shared.watchers[at])
    })
}

#[unsafe(export_name = "__bun_dom_watch_area")]
fn watch_area(by: &Borrower) {
    with_watcher(by, |_| {});
}

#[unsafe(export_name = "__bun_dom_lend_area")]
fn lend_area(to: &Borrower) -> Items {
    watch_area(to);
    let area = Area::of(owner_lent_to(to), &to.bucket);
    Items::new(
        with_shared(|it| it.version),
        area.items
            .borrow()
            .iter()
            .map(|(key, value)| [to_utf16le(key.chars()), to_utf16le(value.chars())]),
    )
}

#[unsafe(export_name = "__bun_dom_change_area")]
fn change_area(by: &Borrower, change: &AreaChange, number: u64, url: &[u8]) {
    const CHANGES_UNTIL_RECEIPT: u64 = 1 << 10;
    with_watcher(by, |it| it.applied = number);
    if number.is_multiple_of(CHANGES_UNTIL_RECEIPT) {
        Changed {
            whose: by.whose,
            bucket: by.bucket[..].into(),
            change: None,
            old_value: None,
            url: None,
            version: 0,
            applied: number,
        }
        .send(by.peer);
    }
    let area = Area::of(owner_lent_to(by), &by.bucket);
    let (key, old_value, new_value) = match change {
        AreaChange::Set { key, value } => {
            let (key, value) = (atom_of(key), string_of(value));
            let old_value = area.items.borrow().get(&key).cloned();
            let size = area.size_with(&key, old_value.as_ref(), &value);
            if size > area.size.get().max(MAX_SIZE) {
                return;
            }
            area.size.set(size);
            area.items.borrow_mut().insert(key.clone(), value.clone());
            (Some(key), old_value, Some(value))
        }
        AreaChange::Remove { key } => {
            let key = atom_of(key);
            let old_value = area.remove(&key);
            (Some(key), old_value, None)
        }
        AreaChange::Clear => {
            area.empty();
            (None, None, None)
        }
    };
    area.keep(|| change.clone());
    area.tell_watchers(
        Some(by.peer),
        || change.clone(),
        old_value.as_ref(),
        Some(url),
    );
    area.broadcast(
        JsHeap::from_global(bun_ui::main_global()),
        None,
        || Some(DomString::from_latin1(url)),
        key.as_ref(),
        old_value.as_ref(),
        new_value.as_ref(),
    );
}

#[unsafe(export_name = "__bun_dom_forget_watcher_of_areas")]
fn forget_watcher(peer: u32) {
    with_shared(|it| it.watchers.retain(|it| it.peer != peer));
}

#[unsafe(export_name = "__bun_dom_area_changed")]
fn area_changed(it: &Changed) {
    let owner = match it.whose {
        Whose::Session(id) => Owner::Profile(Arc::clone(&Session::stand_in_for(id).storage)),
        Whose::Tab(tab) => Owner::Tab(tab),
    };
    let area = Area::find(&owner, &it.bucket).unwrap_or_else(|| {
        Rc::new(Area {
            owner: Some(owner),
            bucket: it.bucket.clone(),
            ..Default::default()
        })
    });
    let (key, new_value) = match &it.change {
        Some(AreaChange::Set { key, value }) => (Some(atom_of(key)), Some(string_of(value))),
        Some(AreaChange::Remove { key }) => (Some(atom_of(key)), None),
        _ => (None, None),
    };
    if let Some(mut borrowed) = area.borrowed.as_ref().map(RefCell::borrow_mut) {
        borrowed
            .last_changes
            .retain(|_, number| *number > it.applied);
        if it.version > borrowed.version && borrowed.last_clearing <= it.applied {
            let is_settled = |key: &Atom| !borrowed.last_changes.contains_key(key);
            match (&key, &new_value) {
                (Some(key), _) if !is_settled(key) => {}
                (Some(key), Some(value)) => {
                    area.size
                        .set(area.size_with(key, area.items.borrow().get(key), value));
                    area.items.borrow_mut().insert(key.clone(), value.clone());
                }
                (Some(key), None) => drop(area.remove(key)),
                (None, _) => {
                    let gone = area
                        .items
                        .borrow()
                        .keys()
                        .iter()
                        .filter(|it| is_settled(it))
                        .cloned()
                        .collect::<Vec<_>>();
                    gone.iter().for_each(|it| drop(area.remove(it)));
                }
            }
        }
    }
    let url = || it.url.as_deref().map(DomString::from_latin1);
    area.broadcast(
        JsHeap::from_global(bun_ui::main_global()),
        None,
        url,
        key.as_ref(),
        it.old_value.as_deref().map(string_of).as_ref(),
        new_value.as_ref(),
    );
}

fn client_of_window(window: &Window) -> Option<Rc<Client>> {
    Realm::of(window.doc()?.global())?.client()
}

fn owner_for(window: &Window, client: &Client, is_local: bool) -> Owner {
    if is_local {
        Owner::Profile(Arc::clone(&client.session.storage))
    } else {
        Owner::Tab(window.host().tab())
    }
}

fn denied<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
    dom_error(
        heap,
        DomError::SecurityError,
        "Access is denied for this document.",
    )
}

fn storage_of<'a>(
    heap: &JsHeap<'a>,
    window: &'a Window,
    is_local: bool,
) -> Result<'a, &'a WebStorage> {
    if let Some(known) = if is_local {
        js_DomWindow::local_storage(window)
    } else {
        js_DomWindow::session_storage(window)
    } {
        return Ok(known);
    }
    let heap = window.realm(heap);
    let area = match client_of_window(window) {
        Some(client) if client.origin().is_opaque() => return Err(denied(heap)),
        Some(client) => Area::for_client(owner_for(window, &client, is_local), &client),
        None => match is_local
            .then(|| window.host().storage_directory())
            .flatten()
        {
            Some(directory) => Area::of(
                Owner::Profile(Storage::of_program(Some(directory.as_bytes()))),
                b"",
            ),
            None => Rc::default(),
        },
    };
    let made = js_WebStorage::create(
        heap,
        WebStorage {
            area,
            _interior: Default::default(),
        },
    );
    js_WebStorage::set_window(made, Some(window));
    if is_local {
        js_DomWindow::set_local_storage(window, Some(made))
    } else {
        js_DomWindow::set_session_storage(window, Some(made))
    }
    Ok(made)
}

impl Window {
    pub(crate) fn get_local_storage<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a WebStorage> {
        storage_of(&cx.heap, self, true)
    }

    pub(crate) fn get_session_storage<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a WebStorage> {
        storage_of(&cx.heap, self, false)
    }
}

pub(crate) fn listen_to_storage(heap: &JsHeap<'_>, window: &Window) {
    client_of_window(window).inspect(|it| it.watch_areas());
    with_shared(|it| {
        it.listening_windows
            .retain(|it| it.get().is_some_and(|it| it != window.to_js()));
        it.listening_windows
            .push(Weak::create_passive(window.to_js(), global_of(heap)));
    });
}

pub(crate) struct WebStorage {
    area: Rc<Area>,
    _interior: bun_jsc::bindgen::Interior,
}

impl WebStorage {
    fn announce(
        &self,
        heap: &JsHeap<'_>,
        key: Option<&Atom>,
        old_value: Option<&DomString>,
        new_value: Option<&DomString>,
    ) {
        let change = || match (key, new_value) {
            (Some(key), Some(value)) => AreaChange::Set {
                key: to_utf16le(key.chars()),
                value: to_utf16le(value.chars()),
            },
            (Some(key), None) => AreaChange::Remove {
                key: to_utf16le(key.chars()),
            },
            (None, _) => AreaChange::Clear,
        };
        let (area, own) = (&self.area, js_WebStorage::window(self));
        let client = || own.and_then(client_of_window);
        area.keep(change);
        if let (Some(mut borrowed), Some(client)) = (
            area.borrowed.as_ref().map(RefCell::borrow_mut),
            area.borrowed.as_ref().and_then(|_| client()),
        ) {
            borrowed.last_change += 1;
            let number = borrowed.last_change;
            match key {
                Some(key) => _ = borrowed.last_changes.insert(key.clone(), number),
                None => borrowed.last_clearing = number,
            }
            client.change_borrowed_area(
                matches!(area.owner, Some(Owner::Profile(_))),
                change(),
                number,
            );
        } else if with_shared(|it| !it.watchers.is_empty()) {
            area.tell_watchers(
                None,
                change,
                old_value,
                client().map(|it| it.url()).as_ref().map(|it| it.href()),
            );
        }
        if own.is_some() {
            area.broadcast(
                heap,
                own,
                || client().map(|it| DomString::from_latin1(it.url().href())),
                key,
                old_value,
                new_value,
            );
        }
    }

    fn area<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, &Area> {
        if js_WebStorage::window(self).is_some_and(|it| it.is_disposed()) {
            Err(denied(heap))
        } else {
            Ok(&self.area)
        }
    }

    pub(crate) fn get_length<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, u32> {
        Ok(self.area(heap)?.items.borrow().len() as u32)
    }

    pub(crate) fn key<'a>(&self, heap: &JsHeap<'a>, index: u32) -> Result<'a, Option<Atom>> {
        Ok(self
            .area(heap)?
            .items
            .borrow()
            .keys()
            .get(index as usize)
            .cloned())
    }

    pub(crate) fn get_item<'a>(
        &self,
        heap: &JsHeap<'a>,
        key: &Atom,
    ) -> Result<'a, Option<DomString>> {
        Ok(self.area(heap)?.items.borrow().get(key).cloned())
    }

    pub(crate) fn set_item<'a>(&self, cx: Cx<'_, 'a>, key: Atom, value: DomString) -> Result<'a> {
        let area = self.area(&cx.heap)?;
        let old_value = area.items.borrow().get(&key).cloned();
        if old_value.as_ref() == Some(&value) {
            return Ok(());
        }
        let size = area.size_with(&key, old_value.as_ref(), &value);
        if size > area.size.get().max(MAX_SIZE) {
            return Err(quota_exceeded(
                cx,
                &format!(
                    "Setting the value of '{}' exceeded the quota.",
                    key.as_utf8()
                ),
            ));
        }
        area.size.set(size);
        self.announce(&cx.heap, Some(&key), old_value.as_ref(), Some(&value));
        area.items.borrow_mut().insert(key, value);
        Ok(())
    }

    pub(crate) fn remove_item<'a>(&self, cx: Cx<'_, 'a>, key: &Atom) -> Result<'a> {
        if let Some(old_value) = self.area(&cx.heap)?.remove(key) {
            self.announce(&cx.heap, Some(key), Some(&old_value), None);
        }
        Ok(())
    }

    pub(crate) fn clear<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a> {
        if self.get_length(&cx.heap)? > 0 {
            self.area.empty();
            self.announce(&cx.heap, None, None, None);
        }
        Ok(())
    }

    pub(crate) fn named_get<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
    ) -> Result<'a, Option<DomString>> {
        self.get_item(&cx.heap, &Atom::from_string(&DomString::from_impl(name)))
    }

    pub(crate) fn named_set<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
        value: DomString,
    ) -> Result<'a> {
        self.set_item(cx, Atom::from_string(&DomString::from_impl(name)), value)
    }

    pub(crate) fn named_delete<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
    ) -> Result<'a> {
        self.remove_item(cx, &Atom::from_string(&DomString::from_impl(name)))
    }

    pub(crate) fn named_keys<'a>(&self, cx: Cx<'_, 'a>, names: &mut PropertyNames) -> Result<'a> {
        self.area(&cx.heap)?
            .items
            .borrow()
            .keys()
            .iter()
            .for_each(|it| names.add(it.as_impl()));
        Ok(())
    }
}

struct Change {
    key: Option<DomString>,
    old_value: Option<DomString>,
    new_value: Option<DomString>,
    url: DomString,
}

#[repr(C)]
pub(crate) struct StorageEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_StorageEvent::Fields,
    change: RefCell<Change>,
}

impl StorageEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &StorageEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let change = Change {
            key: init.key.clone(),
            old_value: init.old_value.clone(),
            new_value: init.new_value.clone(),
            url: init.url.clone(),
        };
        let this = structure.create(
            heap,
            StorageEvent {
                base,
                fields: Default::default(),
                change: change.into(),
            },
        );
        js_StorageEvent::set_storage_area(this, init.storage_area);
        this
    }

    pub(crate) fn get_key(&self, _: &JsHeap<'_>) -> Option<DomString> {
        self.change.borrow().key.clone()
    }

    pub(crate) fn get_old_value(&self, _: &JsHeap<'_>) -> Option<DomString> {
        self.change.borrow().old_value.clone()
    }

    pub(crate) fn get_new_value(&self, _: &JsHeap<'_>) -> Option<DomString> {
        self.change.borrow().new_value.clone()
    }

    pub(crate) fn get_url(&self, _: &JsHeap<'_>) -> DomString {
        self.change.borrow().url.clone()
    }

    pub(crate) fn init_storage_event(
        &self,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        key: Option<DomString>,
        old_value: Option<DomString>,
        new_value: Option<DomString>,
        url: DomString,
        storage_area: Option<&WebStorage>,
    ) {
        if self.init(name, bubbles, cancelable) {
            self.change.replace(Change {
                key,
                old_value,
                new_value,
                url,
            });
            js_StorageEvent::set_storage_area(self, storage_area);
        }
    }
}
