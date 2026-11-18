//! <https://html.spec.whatwg.org/#webstorage>

use core::mem::ManuallyDrop;

use bun_alloc::WTFStringImplStruct;
use bun_collections::ArrayHashMap;
use bun_jsc::Weak;
use bun_jsc::bindgen::{ClassStructure, PropertyNames};
use bun_markup::Chars;
use bun_web::realm::Realm;
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
}

#[derive(Default)]
struct Shared {
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
    with_shared(|it| it.areas.iter().filter(is_meant).for_each(|it| it.empty()));
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
                profile.read_area(bucket, forget, |key, value| {
                    area.size.update(|it| it + (key.len() + value.len()) / 2);
                    area.items.borrow_mut().insert(
                        Atom::from_chars(Chars::Utf16(&from_utf16le(key))),
                        DomString::from_chars(Chars::Utf16(&from_utf16le(value))),
                    );
                });
            }
            area.share()
        })
    }

    fn empty(&self) {
        self.items.take();
        self.size.set(0);
    }

    fn keep(&self, change: impl FnOnce() -> AreaChange) {
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
        }
        .share();
    }
}

#[unsafe(export_name = "__bun_dom_drop_session_storage")]
fn drop_session_storage(tab: u32) {
    with_shared(|it| it.areas.retain(|it| it.owner != Some(Owner::Tab(tab))));
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
        Some(client) if client.origin().is_opaque() => {
            return Err(dom_error(
                heap,
                DomError::SecurityError,
                "Access is denied for this document.",
            ));
        }
        Some(client) => Area::of(owner_for(window, &client, is_local), &client.bucket()),
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
    /// <https://html.spec.whatwg.org/#concept-storage-broadcast>
    fn broadcast(
        &self,
        heap: &JsHeap<'_>,
        key: Option<&Atom>,
        old_value: Option<&DomString>,
        new_value: Option<&DomString>,
    ) {
        let (Some(owner), Some(own)) = (&self.area.owner, js_WebStorage::window(self)) else {
            return;
        };
        let is_local = matches!(owner, Owner::Profile(_));
        for at in 0.. {
            let Some(window) = with_shared(|it| it.listening_windows.get(at).map(Weak::get)) else {
                return;
            };
            let Some(window) = window
                .and_then(|it| Window::from_js(heap, it))
                .filter(|it| it.to_js() != own.to_js())
            else {
                continue;
            };
            let shares = client_of_window(window).is_some_and(|it| {
                owner_for(window, &it, is_local) == *owner && *it.bucket() == *self.area.bucket
            });
            let (true, Some(doc), Some(client)) = (shares, window.doc(), client_of_window(own))
            else {
                continue;
            };
            let url = DomString::from_latin1(client.url().href());
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

    pub(crate) fn get_length(&self) -> u32 {
        self.area.items.borrow().len() as u32
    }

    pub(crate) fn key(&self, _: &JsHeap<'_>, index: u32) -> Option<Atom> {
        self.area.items.borrow().keys().get(index as usize).cloned()
    }

    pub(crate) fn get_item(&self, _: &JsHeap<'_>, key: &Atom) -> Option<DomString> {
        self.area.items.borrow().get(key).cloned()
    }

    pub(crate) fn set_item<'a>(&self, cx: Cx<'_, 'a>, key: Atom, value: DomString) -> Result<'a> {
        let (area, old_value) = (&self.area, self.area.items.borrow().get(&key).cloned());
        if old_value.as_ref() == Some(&value) {
            return Ok(());
        }
        let size = match &old_value {
            Some(old) => area.size.get() - old.len() as usize,
            None => area.size.get() + key.chars().len(),
        } + value.len() as usize;
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
        area.keep(|| AreaChange::Set {
            key: to_utf16le(key.chars()),
            value: to_utf16le(value.chars()),
        });
        self.broadcast(&cx.heap, Some(&key), old_value.as_ref(), Some(&value));
        area.items.borrow_mut().insert(key, value);
        Ok(())
    }

    pub(crate) fn remove_item(&self, cx: Cx<'_, '_>, key: &Atom) {
        let Some((_, old_value)) = self.area.items.borrow_mut().fetch_swap_remove(key) else {
            return;
        };
        self.area
            .size
            .update(|it| it - key.chars().len() - old_value.len() as usize);
        self.area.keep(|| AreaChange::Remove {
            key: to_utf16le(key.chars()),
        });
        self.broadcast(&cx.heap, Some(key), Some(&old_value), None);
    }

    pub(crate) fn clear(&self, cx: Cx<'_, '_>) {
        if self.get_length() > 0 {
            self.area.empty();
            self.area.keep(|| AreaChange::Clear);
            self.broadcast(&cx.heap, None, None, None);
        }
    }

    pub(crate) fn named_get<'a>(
        &self,
        cx: Cx<'_, 'a>,
        name: &WTFStringImplStruct,
    ) -> Result<'a, Option<DomString>> {
        Ok(self.get_item(&cx.heap, &Atom::from_string(&DomString::from_impl(name))))
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
        self.remove_item(cx, &Atom::from_string(&DomString::from_impl(name)));
        Ok(())
    }

    pub(crate) fn named_keys<'a>(&self, _: Cx<'_, 'a>, names: &mut PropertyNames) -> Result<'a> {
        self.area
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
