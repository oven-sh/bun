//! <https://w3c.github.io/ServiceWorker/#dfn-job>

use core::time::Duration;
use std::collections::VecDeque;
use std::rc::Rc;

use bun_core::strings;

use super::registry::{
    BYTES_PER_REGISTRATION, LONGEST_EVENT, NO_ROOM, Registration, Registry, Scripts, Worker,
    form_of,
};
use super::*;
use crate::compiled;
use crate::exec::{Either, Shared, oneshot, race, sleep};
use crate::headers::HeaderList;
use crate::net::body::Chunk;
use crate::net::fetch::{self, Controller, Initiator, Observer, Role};
use crate::net::response::is_ok_status;
use crate::request::{CacheMode, Credentials, Destination, Mode, Redirect};
use crate::time::wall_now;
use crate::{mime, trust};

const MOST_JOBS_IN_QUEUE: usize = 256;
const MOST_TURNS: usize = 8;

type Reply = Option<(Address, u32)>;
type Refusal = (Failure, &'static str);

pub(super) enum Job {
    Register {
        caller: Box<Caller>,
        ticket: u32,
        scope: Url,
        script: Url,
        is_module: bool,
        update_via_cache: UpdateViaCache,
    },
    Update(Id, Wanted, Reply),
    Unregister(Id, Address, u32),
}

/// To load and run scripts, for a bucket.
#[derive(Default)]
pub(super) struct Turns {
    taken: usize,
    waiting: VecDeque<Sender<()>>,
}

struct Turn(Rc<Registry>, Bytes);

impl Drop for Turn {
    fn drop(&mut self) {
        let all = &mut self.0.contents.borrow_mut().turns;
        let Some(turns) = all.get_mut(&self.1) else {
            return;
        };
        match turns.waiting.pop_front() {
            Some(next) => next.send(()),
            None if turns.taken > 1 => turns.taken -= 1,
            None => _ = all.remove(&self.1),
        }
    }
}

pub(super) struct Wanted {
    script: Url,
    is_module: bool,
    update_via_cache: UpdateViaCache,
    referrer: Option<Referrer>,
}

impl Observer for Agent {
    fn allows(&self, request: &Request, _: Option<&Url>) -> bool {
        trust::is_trusted(&request.url, self.app_path())
    }
}

fn settle(reply: Reply, outcome: Outcome) {
    if let Some((address, ticket)) = reply {
        address.tell(Notice::Settled(ticket, outcome));
    }
}

fn essence(loaded: &Loaded) -> Vec<u8> {
    (loaded.head.headers.mime()).map_or_else(Vec::new, |it| it.essence().to_vec())
}

/// The path that the scope has to begin with.
fn widest_scope(script: &Url, headers: &HeaderList) -> Option<Url> {
    let allowed = headers.get(b"service-worker-allowed");
    (script.join(allowed.as_deref().unwrap_or(b"./")))
        .filter(|it| Origin::of(it) == Origin::of(script))
}

impl Registry {
    pub(super) fn schedule(self: &Rc<Self>, job: Job) {
        let mut contents = self.contents.borrow_mut();
        let key = match &job {
            Job::Register { caller, scope, .. } => [&caller.bucket, scope.href()].join(&b' '),
            Job::Update(id, ..) | Job::Unregister(id, ..) => (contents.registration(*id))
                .map(|it| [&it.bucket, it.scope.href()].join(&b' '))
                .unwrap_or_default(),
        };
        let (key, (go, noted)) = (Bytes::from(key), oneshot());
        let (before, count) = contents.queues.get(&key).cloned().unzip();
        drop(contents);
        if count >= Some(MOST_JOBS_IN_QUEUE) {
            let reply = match job {
                Job::Register { caller, ticket, .. } => Some((caller.address, ticket)),
                Job::Update(_, _, reply) => reply,
                Job::Unregister(_, address, ticket) => Some((address, ticket)),
            };
            return settle(
                reply,
                Outcome::Failed(Failure::Abort, "Too much is still to be done."),
            );
        }
        let (this, own_key) = (Rc::clone(self), key.clone());
        let running = Shared::spawn(async move {
            noted.await;
            if let Some(before) = before {
                before.await;
            }
            Rc::clone(&this).work(job).await;
            let queues = &mut this.contents.borrow_mut().queues;
            let count_down = |it: &mut (_, usize)| {
                it.1 -= 1;
                it.1
            };
            if queues.get_mut(&own_key).map(count_down) == Some(0) {
                queues.remove(&own_key);
            }
        });
        let queue = (running, count.unwrap_or_default() + 1);
        self.contents.borrow_mut().queues.insert(key, queue);
        go.send(());
    }

    /// <https://w3c.github.io/ServiceWorker/#soft-update> without a `reply`.
    pub(super) fn update(
        self: &Rc<Self>,
        id: Id,
        reply: Reply,
        referrer: Option<Referrer>,
    ) -> Option<Outcome> {
        let mut contents = self.contents.borrow_mut();
        let about = |it: &mut Registration| Some((it.newest()?, it.update_via_cache));
        let Some((newest, update_via_cache)) = contents.registration(id).and_then(about) else {
            return Some(Outcome::Failed(
                Failure::InvalidState,
                "There is nothing to update.",
            ));
        };
        let newest = contents.workers.get(&newest)?;
        let wanted = Wanted {
            script: newest.info.url.clone(),
            is_module: newest.is_module,
            update_via_cache,
            referrer,
        };
        drop(contents);
        self.schedule(Job::Update(id, wanted, reply));
        None
    }

    fn newest<T>(&self, id: Id, look: impl FnOnce(&Worker) -> T) -> Option<T> {
        let mut contents = self.contents.borrow_mut();
        let newest = contents.registration(id)?.newest()?;
        contents.workers.get(&newest).map(look)
    }

    async fn take_turn(self: &Rc<Self>, id: Id) -> Option<Turn> {
        let bucket = self.contents.borrow_mut().registration(id)?.bucket.clone();
        let waiting = {
            let mut contents = self.contents.borrow_mut();
            let turns = contents.turns.entry(bucket.clone()).or_default();
            (turns.taken == MOST_TURNS).then(oneshot).map_or_else(
                || {
                    turns.taken += 1;
                    None
                },
                |(sender, receiver)| {
                    turns.waiting.push_back(sender);
                    Some(receiver)
                },
            )
        };
        if let Some(waiting) = waiting {
            waiting.await;
        }
        Some(Turn(Rc::clone(self), bucket))
    }

    #[optimize(size)]
    async fn work(self: Rc<Self>, job: Job) {
        let asker = match &job {
            Job::Register { caller, .. } => Some(caller.info.id),
            _ => None,
        };
        let was_known = asker.is_some_and(|it| self.contents.borrow().knows(it));
        let (id, wanted, reply) = match job {
            Job::Register {
                caller,
                ticket,
                scope,
                script,
                is_module,
                update_via_cache,
            } => {
                let reply = Some((caller.address, ticket));
                let found = self.contents.borrow().with_scope(&caller.bucket, &scope);
                let id = found.unwrap_or_else(|| ClientId::next().0);
                let is_same = |it: &Worker| it.info.url == script && it.is_module == is_module;
                let info = self.contents.borrow().info(id);
                if self.newest(id, is_same) == Some(true)
                    && (info.as_ref()).is_some_and(|it| it.update_via_cache == update_via_cache)
                {
                    return settle(reply, Outcome::Registration(info.map(Box::new)));
                }
                let size = script.href().len()
                    + found.map_or_else(|| BYTES_PER_REGISTRATION + scope.href().len(), |_| 0);
                if !self.contents.borrow().has_room(&caller.bucket, size) {
                    return settle(reply, Outcome::Failed(Failure::Quota, NO_ROOM));
                }
                if found.is_none() {
                    self.contents.borrow_mut().registrations.push(Registration {
                        id,
                        ancestors: match strings::contains_char(&caller.bucket, b'^') {
                            true => caller.info.ancestors,
                            false => Vec::new(),
                        },
                        bucket: caller.bucket,
                        scope,
                        update_via_cache,
                        workers: [None; 3],
                        checked_at: wall_now(),
                        preload: (false, b"true"[..].into()),
                        subscriptions: Vec::new(),
                        is_unregistered: false,
                        is_update_due: false,
                    });
                    self.count();
                }
                let wanted = Wanted {
                    script,
                    is_module,
                    update_via_cache,
                    referrer: caller.referrer,
                };
                (id, wanted, reply)
            }
            Job::Update(id, wanted, reply) => {
                let is_registered = (self.contents.borrow_mut().registration(id))
                    .is_some_and(|it| !it.is_unregistered);
                if !is_registered
                    || self.newest(id, |it| it.info.url != wanted.script) == Some(true)
                {
                    let failure = Outcome::Failed(Failure::Type, "The registration has changed.");
                    return settle(reply, failure);
                }
                (id, wanted, reply)
            }
            Job::Unregister(id, address, ticket) => {
                let was_registered = (self.contents.borrow_mut().registration(id))
                    .is_some_and(|it| !core::mem::replace(&mut it.is_unregistered, true));
                settle(
                    Some((address, ticket)),
                    Outcome::Unregistered(was_registered),
                );
                self.save();
                return self.go_on(id);
            }
        };
        let update_via_cache = wanted.update_via_cache;
        let (turn, is_first) = (self.take_turn(id).await, self.newest(id, |_| ()).is_none());
        let made = match was_known && !asker.is_some_and(|it| self.contents.borrow().knows(it)) {
            true => Err((Failure::Abort, "Nobody waits for it any more.")),
            false => self.make(id, wanted).await,
        };
        drop(turn);
        let worker = match made {
            Ok(worker) => worker,
            Err((failure, message)) => {
                settle(reply, Outcome::Failed(failure, message));
                if is_first {
                    self.clear(id);
                }
                return;
            }
        };
        if let Some(it) = self.contents.borrow_mut().registration(id) {
            it.update_via_cache = update_via_cache;
        }
        let Some(worker) = worker else {
            self.contents.borrow().announce(id);
            settle(
                reply,
                Outcome::Registration(self.contents.borrow().info(id).map(Box::new)),
            );
            return self.save();
        };
        self.install(id, worker, reply, is_first).await;
    }

    async fn load(&self, id: Id, mut request: Request, bypasses_cache: bool) -> Result<Loaded> {
        let agent = self.contents.borrow().agent.clone();
        let (scope, ancestors) = (self.contents.borrow_mut().registration(id))
            .map(|it| (it.scope.clone(), it.ancestors.clone()))
            .ok_or(crate::net::NetError::Aborted)?;
        let initiator = Initiator {
            ancestors,
            prohibits_mixed_content: true,
            ..agent.initiator(Role::Page, Some(Origin::of(&scope)))
        };
        if bypasses_cache {
            request.cache = CacheMode::NoCache;
        }
        let controller = Controller::default();
        let loading = async {
            let fetching = fetch::fetch(&self.session, &initiator, request, &agent, &controller);
            let Response { head, body } = fetching.await.map_err(|it| it.error)?;
            let (mut body, mut all) = (body.unwrap_or_default(), Vec::new());
            while let Some(more) = body.read().await? {
                if all.len() + more.len() > MOST_BYTES_OF_SCRIPTS {
                    return Err(crate::net::NetError::InsufficientResources);
                }
                all.extend_from_slice(&more);
            }
            let bytes = Chunk::Owned(all).into_shared();
            Ok(Loaded { head, bytes })
        };
        match race(loading, sleep(Duration::from_millis(LONGEST_EVENT as u64))).await {
            Either::First(loaded) => loaded,
            Either::Second(()) => Err(crate::net::NetError::TimedOut),
        }
    }

    /// <https://w3c.github.io/ServiceWorker/#update-algorithm>. `None` if nothing has changed.
    #[optimize(size)]
    async fn make(
        self: &Rc<Self>,
        id: Id,
        Wanted {
            script,
            is_module,
            update_via_cache,
            referrer,
        }: Wanted,
    ) -> core::result::Result<Option<Id>, Refusal> {
        let about = |it: &mut Registration| (it.scope.clone(), it.is_stale());
        let (scope, is_stale) = (self.contents.borrow_mut().registration(id).map(about))
            .ok_or((Failure::Type, "The registration is gone."))?;
        let (mut source, mut headers) = (None, HeaderList::default());
        if compiled::path_of(script.href(), form_of(is_module)).is_none() {
            let (destination, mode) = (Destination::ServiceWorker, Mode::SameOrigin);
            let credentials = match is_module {
                true => Credentials::Omit,
                false => Credentials::SameOrigin,
            };
            let mut request = Request::new(script.clone(), destination, mode, credentials);
            request
                .cors_exempt_headers
                .set(b"Service-Worker", b"script");
            request.redirect = Redirect::Manual;
            if let Some((url, policy)) = referrer {
                (request.referrer, request.referrer_policy) = (Some(url), policy);
            }
            let bypasses_cache = update_via_cache != UpdateViaCache::All || is_stale;
            let loaded = match compiled::is_exclusive() {
                true => None,
                false => self.load(id, request, bypasses_cache).await.ok(),
            };
            let loaded = loaded.ok_or((Failure::Type, "The script could not be fetched."))?;
            if loaded.head.kind == ResponseType::OpaqueRedirect {
                let is_update = self.newest(id, |it| it.info.url == script) == Some(true);
                let failure = if is_update {
                    Failure::Type
                } else {
                    Failure::Security
                };
                return Err((failure, "The script is behind a redirect."));
            }
            if !is_ok_status(loaded.head.status) {
                return Err((Failure::Type, "The script came with a bad status."));
            }
            if !mime::is_javascript(&essence(&loaded)) {
                return Err((
                    Failure::Security,
                    "The script has an unsupported MIME type.",
                ));
            }
            (source, headers) = (Some(loaded.bytes), loaded.head.headers);
        }
        if !widest_scope(&script, &headers)
            .is_some_and(|it| strings::has_prefix(scope.path(), it.path()))
        {
            return Err((
                Failure::Security,
                "The scope is not under the widest one that is allowed.",
            ));
        }
        if let Some(it) = self.contents.borrow_mut().registration(id) {
            it.checked_at = wall_now();
        }
        let mut imports = Imports {
            bypasses_cache: update_via_cache == UpdateViaCache::None
                || (is_module && update_via_cache != UpdateViaCache::All)
                || is_stale,
            ..Imports::default()
        };
        let newest = self.newest(id, |it| {
            (it.info.url == script && it.is_module == is_module).then_some(it.info.id)
        });
        let known = async { self.scripts(newest.flatten()?).await }.await;
        if let Some(known) = known.filter(|it| it.source.as_deref() == source.as_deref()) {
            let (imported, mut has_changed) = (known.imports.lock().loaded.clone(), false);
            for (url, before) in imported {
                let request = match is_module {
                    true => Request::new(
                        url.clone(),
                        Destination::ServiceWorker,
                        Mode::Cors,
                        Credentials::Omit,
                    ),
                    false => Request::new(
                        url.clone(),
                        Destination::Script,
                        Mode::NoCors,
                        Credentials::Include,
                    ),
                };
                let loaded = self.load(id, request, imports.bypasses_cache).await.ok();
                let good = loaded.filter(|it| {
                    is_ok_status(it.head.status) && {
                        let kind = essence(it);
                        mime::is_javascript(&kind) || kind == essence(&before)
                    }
                });
                has_changed |= good.as_ref().is_some_and(|it| *it.bytes != *before.bytes);
                match good.filter(|it| imports.has_room_for(it)) {
                    Some(it) => imports.loaded.push((url, it)),
                    None => imports.missing.push(url),
                }
            }
            if !has_changed {
                return Ok(None);
            }
        }
        let worker = Worker {
            is_module,
            is_compiled: source.is_none(),
            scripts: Some(Scripts {
                source,
                headers,
                imports: Arc::new(Guarded::new(imports)),
            }),
            ..Worker::new(script, State::Parsed, id)
        };
        let made = worker.info.id;
        self.contents.borrow_mut().workers.insert(made, worker);
        if async { self.run(made)?.await }.await.is_none() {
            let mut contents = self.contents.borrow_mut();
            contents.workers.remove(&made);
            return Err(match contents.registration(id) {
                Some(_) => (Failure::Type, "The script could not be run."),
                None => (Failure::Abort, "The registration is gone."),
            });
        }
        Ok(Some(made))
    }

    async fn keep_scripts(&self, id: Id, worker: Id) -> Option<()> {
        self.sweep();
        // Another process may put some there too.
        let row = (crate::random() >> 11) as i64;
        let (bucket, url, scripts) = {
            let mut contents = self.contents.borrow_mut();
            let bucket = contents.registration(id)?.bucket.clone();
            contents.rows.push(row);
            let worker = contents.workers.get_mut(&worker)?;
            worker.row = Some(row);
            (bucket, worker.info.url.clone(), worker.scripts.clone()?)
        };
        {
            let mut imports = scripts.imports.lock();
            let used = core::mem::take(&mut imports.used);
            imports.loaded.retain(|it| used.contains(&it.0));
            imports.is_complete = true;
        }
        let storage = Arc::clone(&self.session.storage);
        let write = move || stored::write_scripts(&url, &scripts);
        storage.keep_scripts(row, bucket, write).await.ok()
    }

    /// <https://w3c.github.io/ServiceWorker/#installation-algorithm>
    async fn install(self: &Rc<Self>, id: Id, worker: Id, reply: Reply, is_first: bool) {
        {
            let mut contents = self.contents.borrow_mut();
            contents.set_slot(id, INSTALLING, Some(worker));
            contents.set_state(worker, State::Installing);
            settle(
                reply,
                Outcome::Registration(contents.info(id).map(Box::new)),
            );
            contents.announce_update(id);
            (contents.info(id).into_iter()).for_each(|it| self.report(News::Registered(it.scope)));
        }
        let is_installed = self.pass_through(worker, State::Installing).await
            && self.keep_scripts(id, worker).await.is_some();
        let slots = self
            .contents
            .borrow_mut()
            .registration(id)
            .map(|it| it.workers);
        let Some(slots) = slots.filter(|it| it[INSTALLING] == Some(worker)) else {
            return;
        };
        if !is_installed {
            self.contents.borrow_mut().set_slot(id, INSTALLING, None);
            self.discard(worker);
            if is_first {
                self.clear(id);
            }
            return;
        }
        slots[WAITING].into_iter().for_each(|it| self.discard(it));
        let mut contents = self.contents.borrow_mut();
        contents.set_slot(id, WAITING, Some(worker));
        contents.set_slot(id, INSTALLING, None);
        contents.set_state(worker, State::Installed);
        drop(contents);
        self.save();
        self.go_on(id);
    }
}
