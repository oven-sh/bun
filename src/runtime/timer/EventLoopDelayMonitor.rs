use std::rc::Rc;

use bun_jsc::virtual_machine::VirtualMachine;

use super::All;
use crate::node::histogram::Interval;

pub(crate) fn enable(interval: &Rc<Interval>) {
    super::EventLoopDelayMonitor::enable(All::of(VirtualMachine::get()), interval);
}

pub(crate) fn disable(interval: &Rc<Interval>) {
    super::EventLoopDelayMonitor::disable(All::of(VirtualMachine::get()), interval);
}
