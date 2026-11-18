use std::cell::Cell;

use super::keyboard::modifiers;
use super::window::Window;
use crate::input;
use crate::platform::{Cursor, Input, Phase, Point};
use crate::protocol::{Contact, TouchPhase};
use crate::win32::*;

#[derive(Clone, Copy, Default)]
struct Click {
    time: i32,
    button: u8,
    at: DevicePoint,
    count: u32,
}

#[derive(Default)]
pub struct Pointer {
    pub at: Cell<Point>,
    pub cursor: Cell<Cursor>,
    buttons: Cell<u8>,
    click: Cell<Click>,
    /// Whether in the content or on what counts as the frame.
    tracked: Cell<Option<bool>>,
    last_move: Cell<Option<DevicePoint>>,
    /// It is left to the system, which makes a mouse of it.
    is_pen_elsewhere: Cell<bool>,
    button_of_pen: Cell<u8>,
}

fn load(cursor: Cursor) -> Handle {
    let name = match cursor {
        Cursor::Hidden => return 0,
        Cursor::IBeam | Cursor::VerticalIBeam => IDC_IBEAM,
        Cursor::Crosshair | Cursor::Cell | Cursor::ZoomIn | Cursor::ZoomOut => IDC_CROSS,
        Cursor::OpenHand | Cursor::PointingHand => IDC_HAND,
        Cursor::ClosedHand | Cursor::Move => IDC_SIZEALL,
        Cursor::Wait => IDC_WAIT,
        Cursor::Progress => IDC_APPSTARTING,
        Cursor::Help => IDC_HELP,
        Cursor::ResizeLeft
        | Cursor::ResizeRight
        | Cursor::ResizeLeftRight
        | Cursor::ResizeColumn => IDC_SIZEWE,
        Cursor::ResizeUp | Cursor::ResizeDown | Cursor::ResizeUpDown | Cursor::ResizeRow => {
            IDC_SIZENS
        }
        Cursor::ResizeUpLeftDownRight => IDC_SIZENWSE,
        Cursor::ResizeUpRightDownLeft => IDC_SIZENESW,
        Cursor::NotAllowed => IDC_NO,
        Cursor::Arrow | Cursor::DragLink | Cursor::DragCopy | Cursor::ContextMenu => IDC_ARROW,
    };
    LoadCursorW(0, Str::numbered(name))
}

impl Window {
    pub fn show_cursor(&self) {
        SetCursor(load(self.pointer.cursor.get()));
    }

    pub fn change_cursor(&self, cursor: Cursor) {
        if self.pointer.cursor.replace(cursor) != cursor
            && self.pointer.tracked.get() == Some(true)
            && !super::drag::is_dragging()
        {
            self.show_cursor();
        }
    }

    pub fn is_pressed(&self) -> bool {
        self.pointer.buttons.get() & 1 != 0
    }

    pub fn point_at(&self, at: DevicePoint) -> Point {
        self.pointer.at.set(self.logical(at));
        self.pointer.at.get()
    }

    pub fn pointer_moved(&self, at: DevicePoint, is_in_content: bool) {
        if self.pointer.tracked.replace(Some(is_in_content)) != Some(is_in_content) {
            let flags = TME_LEAVE | if is_in_content { 0 } else { TME_NONCLIENT };
            TrackMouseEvent(&mut MouseTracking {
                cb_size: size_of::<MouseTracking>() as u32,
                dw_flags: flags,
                hwnd_track: self.handle,
                dw_hover_time: 0,
            });
        }
        // The system also sends it when windows come and go.
        if self.pointer.last_move.replace(Some(at)) != Some(at) {
            input::handle(
                self.id,
                Input::MouseMove {
                    at: self.point_at(at),
                    is_pressed: self.pointer.buttons.get() != 0,
                    modifiers: modifiers(),
                },
            );
        }
    }

    pub fn pointer_left(&self, was_in_content: bool) {
        if self.pointer.tracked.get() == Some(was_in_content) {
            self.pointer.tracked.set(None);
            self.pointer.last_move.set(None);
            input::handle(
                self.id,
                Input::MouseLeave {
                    at: self.pointer.at.get(),
                    modifiers: modifiers(),
                },
            );
        }
    }

    pub fn press(&self, device: DevicePoint, button: u8) {
        let (last, time) = (self.pointer.click.get(), GetMessageTime());
        let is_near = (device.x - last.at.x).abs() <= self.metric(SM_CXDOUBLECLK) / 2
            && (device.y - last.at.y).abs() <= self.metric(SM_CYDOUBLECLK) / 2;
        let continues = time.wrapping_sub(last.time) as u32 <= GetDoubleClickTime()
            && is_near
            && button == last.button;
        let clicks = if continues { last.count + 1 } else { 1 };
        self.pointer.click.set(Click {
            time,
            button,
            at: device,
            count: clicks,
        });
        self.end_composition();
        self.pointer.buttons.update(|it| it | 1 << button);
        SetCapture(self.handle);
        input::handle(
            self.id,
            Input::MouseDown {
                at: self.point_at(device),
                button,
                clicks,
                modifiers: modifiers(),
            },
        );
    }

    pub fn release(&self, at: Point, button: u8) {
        if self.pointer.buttons.get() & 1 << button == 0 {
            return;
        }
        self.pointer.buttons.update(|it| it & !(1 << button));
        if self.pointer.buttons.get() == 0 && GetCapture() == self.handle {
            ReleaseCapture();
        }
        input::handle(
            self.id,
            Input::MouseUp {
                at,
                button,
                clicks: self.pointer.click.get().count,
                modifiers: modifiers(),
            },
        );
    }

    pub fn lost_pointer(&self) {
        if !super::drag::is_dragging() && self.pointer.buttons.take() != 0 {
            input::handle(
                self.id,
                Input::MouseMove {
                    at: self.pointer.at.get(),
                    is_pressed: false,
                    modifiers: modifiers(),
                },
            );
        }
    }

    /// For the system's own use.
    pub fn give_up_pointer(&self) {
        self.pointer.buttons.set(0);
        ReleaseCapture();
    }

    /// Returns whether it is dealt with.
    pub fn contact(&self, message: u32, pointer: u32) -> bool {
        let mut kind = 0;
        GetPointerType(pointer, &mut kind);
        match kind {
            PT_TOUCH => self.finger(message, pointer),
            PT_PEN => self.pen(message, pointer),
            _ => false,
        }
    }

    fn finger(&self, message: u32, pointer: u32) -> bool {
        let mut info = PointerTouchInfo::default();
        GetPointerTouchInfo(pointer, &mut info);
        let phase = match message {
            WM_POINTERCAPTURECHANGED => TouchPhase::Cancel,
            _ if info.pointer_info.pointer_flags & POINTER_FLAG_CANCELED != 0 => TouchPhase::Cancel,
            WM_POINTERDOWN => TouchPhase::Start,
            WM_POINTERUPDATE if info.pointer_info.pointer_flags & POINTER_FLAG_INCONTACT != 0 => {
                TouchPhase::Move
            }
            WM_POINTERUP => TouchPhase::End,
            _ => return false,
        };
        if phase == TouchPhase::Start {
            self.end_composition();
        }
        let size = [info.rc_contact.width(), info.rc_contact.height()]
            .map(|it| (it as f32 / self.scale()).max(1.));
        let contact = Contact {
            size,
            pressure: info.pressure as f32 / 1024.,
            ..Default::default()
        };
        input::touch(
            self.id,
            phase,
            pointer as i32,
            self.logical(self.in_content(info.pointer_info.pt_pixel_location_raw)),
            contact,
            modifiers(),
        )
    }

    fn pen(&self, message: u32, pointer: u32) -> bool {
        const ERASER: u8 = 5;
        let mut info = PointerPenInfo::default();
        if GetPointerPenInfo(pointer, &mut info) == 0 {
            return false;
        }
        let (at, is_down) = (
            self.in_content(info.pointer_info.pt_pixel_location_raw),
            info.pointer_info.pointer_flags & POINTER_FLAG_INCONTACT != 0,
        );
        if message == WM_POINTERDOWN || message == WM_POINTERUPDATE && !is_down {
            self.pointer
                .is_pen_elsewhere
                .set(!input::takes_contacts(self.id, self.logical(at)));
        }
        if self.pointer.is_pen_elsewhere.get() {
            return false;
        }
        let pressure = if info.pen_mask & PEN_MASK_PRESSURE != 0 {
            info.pressure as f32 / 1024.
        } else {
            0.5
        };
        let contact = Contact {
            size: [1.; 2],
            pressure: if is_down { pressure } else { 0. },
            tilt: [info.tilt_x as i16, info.tilt_y as i16],
            twist: info.rotation as i16,
        };
        input::with_pen(contact, || match message {
            WM_POINTERDOWN => {
                let button = [(PEN_FLAG_ERASER, ERASER), (PEN_FLAG_BARREL, 2)]
                    .into_iter()
                    .find(|it| info.pen_flags & it.0 != 0)
                    .map_or(0, |it| it.1);
                self.pointer.button_of_pen.set(button);
                self.press(at, button);
            }
            WM_POINTERUP => self.release(self.point_at(at), self.pointer.button_of_pen.get()),
            WM_POINTERUPDATE => input::handle(
                self.id,
                Input::MouseMove {
                    at: self.point_at(at),
                    is_pressed: is_down,
                    modifiers: modifiers(),
                },
            ),
            WM_POINTERLEAVE => input::handle(
                self.id,
                Input::MouseLeave {
                    at: self.point_at(at),
                    modifiers: modifiers(),
                },
            ),
            _ => {}
        });
        true
    }

    pub fn wheel_turned(&self, at: DevicePoint, amount: i32, is_horizontal: bool) {
        let setting = system_parameter(
            if is_horizontal {
                SPI_GETWHEELSCROLLCHARS
            } else {
                SPI_GETWHEELSCROLLLINES
            },
            3u32,
        );
        let page = self.client_size().1 as f32 / self.scale() * 0.875 / input::PIXELS_PER_LINE;
        let lines = amount as f32 / WHEEL_DELTA as f32
            * if setting == u32::MAX {
                page
            } else {
                setting as f32
            };
        let mut source = InputMessageSource::default();
        GetCurrentInputMessageSource(&mut source);
        // The system has smoothed that, and lets it coast.
        let is_precise = source.device_type == IMDT_TOUCHPAD;
        let way = if is_precise {
            lines * input::PIXELS_PER_LINE
        } else {
            lines
        };
        let delta = if is_horizontal {
            Point { x: -way, y: 0. }
        } else {
            Point { x: 0., y: way }
        };
        input::handle(
            self.id,
            Input::Scroll {
                at: self.point_at(at),
                delta,
                is_precise,
                phase: Phase::Moved,
                modifiers: modifiers(),
            },
        );
    }
}
