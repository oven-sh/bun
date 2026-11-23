//! A descriptor that script gets as a number. Only the code that adopts it knows whether it did.

use core::cell::Cell;
use core::marker::PhantomData;

use bun_jsc::JsCell;
use bun_sys::{CloseOnDrop, Fd};
use bun_uws::LIBUS_SOCKET_DESCRIPTOR as Descriptor;

use crate::jsc_hooks::runtime_state;

#[derive(Default)]
pub(crate) struct OfferedFds {
    open: JsCell<Vec<Offered>>,
    tickets: Cell<u64>,
}

struct Offered {
    fd: Descriptor,
    ticket: Ticket,
    state: State,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    Untried,
    /// Untried, and outlasts its [`Offer`].
    Held,
    Rejected,
}

/// The right to close a descriptor that is on offer. Unlike the number, it is never used again.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) struct Ticket(u64);

impl Ticket {
    pub(crate) fn refuse(self) {
        close(withdraw(|it| it.ticket == self));
    }

    pub(crate) fn to_number(self) -> f64 {
        self.0 as f64
    }

    pub(crate) fn from_number(number: f64) -> Self {
        Self(number as u64)
    }
}

/// Closes the descriptor, unless it is claimed or still held by then.
pub(crate) struct Offer(Fd, Ticket, PhantomData<*const ()>);

impl Offer {
    pub(crate) fn new(fd: CloseOnDrop) -> Self {
        let received = fd.into_raw();
        let fd = received.native() as Descriptor;
        // Script has closed the number of one that it held.
        claim(fd);
        let offered = &runtime_state().offered_fds;
        let ticket = Ticket(offered.tickets.replace(offered.tickets.get() + 1));
        let state = State::Untried;
        (offered.open).with_mut(|open| open.push(Offered { fd, ticket, state }));
        Self(received, ticket, PhantomData)
    }

    pub(crate) fn fd(&self) -> Fd {
        self.0
    }

    /// A patched `listen()`, `connect()` or `bind()` can get to it later.
    pub(crate) fn leave_untried_to_script(self) {
        withdraw(|it| it.ticket == self.1 && it.state == State::Untried);
    }
}

impl Drop for Offer {
    fn drop(&mut self) {
        close(withdraw(|it| {
            it.ticket == self.1 && it.state != State::Held
        }));
    }
}

/// The caller closes `fd` from now on.
pub(crate) fn claim(fd: Descriptor) {
    withdraw(|it| it.fd == fd);
}

pub(crate) fn hold(fd: Descriptor) -> Option<Ticket> {
    mark(fd, State::Held)
}

/// For the code that has tried to adopt `fd`.
pub(crate) fn settle<T>(fd: Descriptor, adopted: Option<T>) -> Option<T> {
    if adopted.is_some() || (mark(fd, State::Rejected).is_some() && script_has_closed(fd)) {
        claim(fd);
    }
    adopted
}

#[cfg(not(windows))]
fn script_has_closed(fd: Descriptor) -> bool {
    bun_sys::get_fcntl_flags(Fd::from_native(fd)).is_err()
}

/// `node:fs` cannot close a `SOCKET`.
#[cfg(windows)]
fn script_has_closed(_: Descriptor) -> bool {
    false
}

fn mark(fd: Descriptor, state: State) -> Option<Ticket> {
    runtime_state().offered_fds.open.with_mut(|open| {
        let offered = open.iter_mut().find(|it| it.fd == fd)?;
        offered.state = state;
        Some(offered.ticket)
    })
}

fn withdraw(which: impl FnMut(&Offered) -> bool) -> Option<Descriptor> {
    runtime_state().offered_fds.open.with_mut(|open| {
        let at = open.iter().position(which)?;
        Some(open.swap_remove(at).fd)
    })
}

fn close(withdrawn: Option<Descriptor>) {
    let Some(fd) = withdrawn else { return };
    #[cfg(windows)]
    bun_uws::socket_transfer::bsd_close_socket(fd);
    #[cfg(not(windows))]
    drop(CloseOnDrop::new(Fd::from_native(fd)));
}
