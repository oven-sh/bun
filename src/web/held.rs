//! What a realm has to let go of when it stops, however long its objects take to be collected.

use core::cell::RefCell;
use core::ffi::c_void;
use std::rc::{Rc, Weak};

use crate::exec::{self, LocalFuture, oneshot, race};
use crate::realm::{Realm, Scope};

pub type Held<T> = Rc<RefCell<Option<T>>>;

trait Release {
    fn release(&self);
}

impl<T> Release for RefCell<Option<T>> {
    fn release(&self) {
        drop(self.take());
    }
}

static HELD: bun_ui::Lasting<RefCell<Vec<(*const Realm, Weak<dyn Release>)>>> =
    bun_ui::Lasting::empty();

fn release(is_meant: impl Fn(*const Realm) -> bool) {
    let held: Vec<_> = HELD.with(|it| {
        it.borrow_mut()
            .extract_if(.., |it| is_meant(it.0))
            .collect()
    });
    held.iter()
        .rev()
        .filter_map(|it| it.1.upgrade())
        .for_each(|it| it.release());
}

impl Realm {
    pub fn hold<T: 'static>(&self, value: T) -> Held<T> {
        extern "C" fn release_everything(_: *mut c_void) {
            release(|_| true);
        }
        let held = Rc::new(RefCell::new((!self.has_let_go()).then_some(value)));
        HELD.with(|all| {
            let mut all = all.borrow_mut();
            if all.capacity() == 0 {
                exec::at_exit(release_everything);
            }
            if all.len() == all.capacity() {
                all.retain(|it| it.1.strong_count() > 0);
                let left = all.len();
                all.reserve(left.max(16));
            }
            all.push((self, Rc::downgrade(&held) as Weak<dyn Release>));
        });
        held
    }

    /// A worker that is closing finishes its task, and lets go when its thread ends.
    pub fn has_let_go(&self) -> bool {
        self.is_stopped() && self.scope() == Scope::Window
    }

    pub(crate) fn release_held(&self) {
        if self.has_let_go() {
            release(|it| core::ptr::eq(it, self));
        }
    }

    /// It does not go on after this has stopped.
    pub fn spawn(&self, future: LocalFuture<'static, ()>) {
        let (sender, stopped) = oneshot::<()>();
        let sender = self.hold(sender);
        exec::spawn(async move {
            race(future, stopped).await;
            drop(sender);
        });
    }
}
