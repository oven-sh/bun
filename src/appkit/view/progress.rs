//! `Progress`: a bar or spinner, determinate or not.

use super::{Cx, Prop, Widget};
use crate::error::Result;
use crate::geometry::Rect;
use crate::objc;
use crate::objc::appkit::{ControlSize, NSProgressIndicator, NSView, ProgressIndicatorStyle};

const DEFAULT_MIN: f64 = 0.0;
const DEFAULT_MAX: f64 = 100.0;
const DEFAULT_RUNNING: bool = true;
const DEFAULT_INDETERMINATE: bool = false;
const DEFAULT_SPINNER: bool = false;

pub(crate) struct Progress {
    view: NSProgressIndicator,
    /// The value as asked for, once one has been. NSProgressIndicator clamps
    /// into `[min, max]` on assignment, so it is applied again whenever the
    /// range changes.
    wanted: Option<f64>,
    running: bool,
    indeterminate: bool,
    spinner: bool,
}

impl Progress {
    pub(crate) fn new(_cx: &Cx<'_>) -> Progress {
        let view = NSProgressIndicator::init_with_frame(
            objc::alloc::<NSProgressIndicator>(),
            Rect::default(),
        );
        view.set_min_value(DEFAULT_MIN);
        view.set_max_value(DEFAULT_MAX);
        view.set_displayed_when_stopped(true);
        let progress = Progress {
            view,
            wanted: None,
            running: DEFAULT_RUNNING,
            indeterminate: DEFAULT_INDETERMINATE,
            spinner: DEFAULT_SPINNER,
        };
        progress.sync();
        progress
    }

    fn reapply_value(&self) {
        if let Some(v) = self.wanted {
            self.view.set_double_value(v);
        }
    }

    fn sync(&self) {
        self.view.set_style(if self.spinner {
            ProgressIndicatorStyle::Spinning
        } else {
            ProgressIndicatorStyle::Bar
        });
        self.view.set_control_size(ControlSize::Regular);
        self.view.set_indeterminate(self.indeterminate);
        // The indeterminate animation only runs if started after the
        // switch; a determinate bar ignores start/stop.
        if self.indeterminate && self.running {
            self.view.start_animation(None);
        } else {
            self.view.stop_animation(None);
        }
    }
}

impl Widget for Progress {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Number(v) => {
                self.wanted = Some(v);
                self.view.set_double_value(v);
            }
            Prop::Min(v) => {
                self.view.set_min_value(v.unwrap_or(DEFAULT_MIN));
                self.reapply_value();
            }
            Prop::Max(v) => {
                self.view.set_max_value(v.unwrap_or(DEFAULT_MAX));
                self.reapply_value();
            }
            Prop::Indeterminate(b) => {
                self.indeterminate = b.unwrap_or(DEFAULT_INDETERMINATE);
                self.sync();
            }
            Prop::Running(b) => {
                self.running = b.unwrap_or(DEFAULT_RUNNING);
                self.sync();
            }
            Prop::Spinner(b) => {
                self.spinner = b.unwrap_or(DEFAULT_SPINNER);
                self.sync();
            }
            other => return Ok(Some(other)),
        }
        Ok(None)
    }
}
