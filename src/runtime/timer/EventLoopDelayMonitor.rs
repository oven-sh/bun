use std::rc::Rc;

use crate::jsc_hooks::timer_all;
use crate::node::histogram::Interval;

pub(crate) fn enable(interval: &Rc<Interval>) {
    super::EventLoopDelayMonitor::enable(timer_all(), interval);
}

pub(crate) fn disable(interval: &Rc<Interval>) {
    super::EventLoopDelayMonitor::disable(timer_all(), interval);
}
