//! What runs later on the thread of the `Vm`, from the event loop of the embedder.

mod host;
mod run_loop;
mod ticket;
mod timer;

use core::cell::{Cell, RefCell};
use std::sync::Arc;

pub use host::EventLoop;
pub use run_loop::RunLoop;
pub use ticket::{DeferredTask, Ticket, WeakTicket, WorkKind};
pub use timer::{Timer, TimerQueue};

use crate::heap::{Scope, Survivors};
use crate::{Visitor, Vm};
use host::Host;

#[derive(Default)]
pub(crate) struct State {
    host: Arc<Host>,
    tickets: RefCell<Vec<WeakTicket>>,
    /// The tickets from here on are new since the last collection.
    first_young_ticket: Cell<usize>,
}

impl State {
    fn first_ticket_in(&self, scope: Scope) -> usize {
        match scope {
            Scope::Eden => self.first_young_ticket.get(),
            Scope::Full => 0,
        }
    }

    /// Forgets them too, and those that are over. The embedder hears of it with nothing borrowed.
    fn cancel_tickets(&self, first: usize, is_doomed: impl Fn(&Ticket) -> bool) {
        let dropped: Vec<WeakTicket> = (self.tickets.borrow_mut())
            .extract_if(first.., |it| it.upgrade().is_none_or(|it| is_doomed(&it)))
            .collect();
        for ticket in dropped {
            ticket.cancel();
        }
    }
}

impl crate::services::Service for State {
    fn visit_output_constraints(&self, visitor: &mut Visitor) {
        let tickets = self.tickets.borrow();
        for ticket in &tickets[self.first_ticket_in(visitor.scope())..] {
            if let Some(ticket) = ticket.upgrade() {
                ticket.visit(visitor);
            }
        }
    }

    fn reconcile_weak_references(&self, _: &Vm, survivors: &Survivors) {
        let first = self.first_ticket_in(survivors.scope());
        self.cancel_tickets(first, |ticket| !ticket.has_survived(survivors));
        self.first_young_ticket.set(self.tickets.borrow().len());
    }

    fn will_destroy(&self, _: &Vm) {
        self.cancel_tickets(0, |_| true);
        self.host.close();
    }
}
