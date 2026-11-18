//! What happens to the surface that shows a page.

use bun_ui::protocol::{self, DragPhase, Located, MouseAction};
use bun_ui::surfaces::News;

use crate::host::{ChosenFile, Keystroke};
use crate::wire;

wire! {
    #[derive(Clone, Copy, PartialEq, Default)]
    pub struct Place {
        /// In the surface, without the zoom of the page. NaN if the mouse leaves and nobody knows where.
        pub window: [f64; 2],
        pub screen: [f64; 2],
        pub modifiers: u32,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Action {
        Move,
        Down,
        Up,
        Leave,
    }

    /// Buttons are numbered as in the DOM.
    #[derive(Clone, Copy)]
    pub struct Mouse {
        pub action: Action,
        pub place: Place,
        pub button: i16,
        pub buttons: u16,
        pub clicks: i32,
    }

    #[derive(Clone, Copy, PartialEq)]
    pub struct Details {
        pub size: [f64; 2],
        pub pressure: Option<f64>,
        pub tangential_pressure: f64,
        pub tilt: [i32; 2],
        pub twist: i32,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Phase {
        Start,
        Move,
        End,
        Cancel,
    }

    #[derive(Clone, Copy, PartialEq)]
    pub struct Finger {
        pub id: i32,
        pub place: Place,
        pub details: Details,
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Drag {
        Enter,
        Over,
        Leave,
        Drop,
    }

    #[derive(Clone, Copy)]
    pub struct Extent {
        pub size: [f64; 2],
        pub scale: f64,
    }

    #[derive(Clone)]
    pub enum Input {
        Mouse(Mouse),
        Pen { mouse: Mouse, details: Details },
        Touch { phase: Phase, fingers: Vec<Finger>, modifiers: u32 },
        /// `is_handled`: the compositor scrolls.
        Wheel { place: Place, delta: [f64; 2], is_precise: bool, is_handled: bool },
        Pinch { place: Place, delta: f64 },
        Scroll { node: u32, generation: u32, total: [f64; 2], has_ended: bool },
        Key(Keystroke),
        /// By the app.
        KeyTaken,
        Text { text: String, is_typed: bool, range: Option<[u32; 2]> },
        Compose { text: String, selection: Option<[u32; 2]>, range: Option<[u32; 2]> },
        EndComposition,
        /// `is_quiet`: it is not shown at once.
        Resize { extent: Extent, is_quiet: bool },
        /// `direction` is that of the tab key that has brought it, or 0.
        Focus { direction: i32 },
        /// `leaves`: for another frame of the window.
        Blur { leaves: bool },
        Drag { phase: Drag, place: Place, files: Vec<ChosenFile> },
        AccessibilityChanged,
        Perform { node: u32, action: u8, numbers: [u32; 4], text: String },
        Outside,
        Frame { is_urgent: bool },
    }
}

/// In the modifiers of the mouse.
pub const COMPOSITOR_SCROLLS: u32 = 1 << 8;

impl From<Located> for Place {
    fn from(at: Located) -> Place {
        Place {
            window: [at.x, at.y].map(f64::from),
            screen: [at.screen_x, at.screen_y].map(f64::from),
            modifiers: at.modifiers.into(),
        }
    }
}

impl From<News> for Input {
    fn from(news: News) -> Input {
        use protocol::Input as Native;
        let News::Input(input) = news else {
            return Input::AccessibilityChanged;
        };
        match input {
            Native::Frame { .. } => Input::Frame { is_urgent: false },
            Native::Resize { size, scale } => Input::Resize {
                extent: Extent {
                    size: [size.width, size.height].map(f64::from),
                    scale: scale.into(),
                },
                is_quiet: false,
            },
            Native::Mouse(it) => Input::Mouse(Mouse {
                action: match it.action {
                    MouseAction::Move => Action::Move,
                    MouseAction::Down => Action::Down,
                    MouseAction::Up => Action::Up,
                    MouseAction::Leave => Action::Leave,
                },
                place: Place {
                    modifiers: u32::from(it.at.modifiers)
                        | if it.at.is_handled {
                            COMPOSITOR_SCROLLS
                        } else {
                            0
                        },
                    ..it.at.into()
                },
                button: it.button.into(),
                buttons: it.buttons.into(),
                clicks: it.clicks as i32,
            }),
            Native::Wheel(it) => Input::Wheel {
                place: it.at.into(),
                delta: it.delta,
                is_precise: it.is_precise,
                is_handled: it.at.is_handled,
            },
            Native::Pinch { at, delta } => Input::Pinch {
                place: Place {
                    screen: Place::from(at).window,
                    ..at.into()
                },
                delta: delta.into(),
            },
            Native::Scroll {
                node,
                generation,
                total,
                has_ended,
            } => Input::Scroll {
                node,
                generation,
                total,
                has_ended,
            },
            Native::Key(it) => Input::Key(Keystroke {
                is_down: it.is_down,
                key: (*it.key).into(),
                code: (*it.code).into(),
                location: it.location.into(),
                modifiers: it.modifiers.into(),
                repeats: it.is_repeat,
                is_composing: it.is_composing,
            }),
            Native::Text {
                text,
                is_typed,
                range,
            } => Input::Text {
                text: (*text).into(),
                is_typed,
                range: range.get(),
            },
            Native::Compose {
                text,
                selection,
                range,
            } => Input::Compose {
                text: (*text).into(),
                selection: Some(selection),
                range: range.get(),
            },
            Native::EndComposition => Input::EndComposition,
            Native::Focus => Input::Focus { direction: 0 },
            Native::Blur => Input::Blur { leaves: false },
            Native::Outside => Input::Outside,
            Native::Drag { phase, at, paths } => Input::Drag {
                phase: match phase {
                    DragPhase::Enter => Drag::Enter,
                    DragPhase::Over => Drag::Over,
                    DragPhase::Leave => Drag::Leave,
                    DragPhase::Drop => Drag::Drop,
                },
                place: Place {
                    modifiers: 0,
                    ..at.into()
                },
                files: paths.iter().map(|it| ChosenFile((**it).into())).collect(),
            },
            Native::Perform {
                node,
                action,
                numbers,
                text,
                ..
            } => Input::Perform {
                node,
                action: action as u8,
                numbers,
                text: (*text).into(),
            },
        }
    }
}

impl Input {
    /// Of a mouse, a pen, or what is done with them.
    pub fn place(&self) -> Option<Place> {
        match self {
            Input::Mouse(mouse) | Input::Pen { mouse, .. } => Some(mouse.place),
            Input::Wheel { place, .. } | Input::Pinch { place, .. } | Input::Drag { place, .. } => {
                Some(*place)
            }
            _ => None,
        }
    }

    /// <https://html.spec.whatwg.org/#activation-triggering-input-event>
    pub fn may_activate(&self) -> bool {
        match self {
            Input::Mouse(mouse) | Input::Pen { mouse, .. } => {
                matches!(mouse.action, Action::Down | Action::Up)
            }
            Input::Key(key) => key.is_down,
            Input::Touch { phase, .. } => matches!(phase, Phase::Start | Phase::End),
            Input::Perform { .. } => true,
            _ => false,
        }
    }

    pub fn move_places(&mut self, to: impl Fn([f64; 2]) -> [f64; 2]) {
        match self {
            Input::Mouse(Mouse { place, .. })
            | Input::Pen {
                mouse: Mouse { place, .. },
                ..
            }
            | Input::Wheel { place, .. }
            | Input::Pinch { place, .. }
            | Input::Drag { place, .. } => place.window = to(place.window),
            Input::Touch { fingers, .. } => {
                (fingers.iter_mut()).for_each(|it| it.place.window = to(it.place.window));
            }
            _ => {}
        }
    }
}
