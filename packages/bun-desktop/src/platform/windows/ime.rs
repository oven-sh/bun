//! https://learn.microsoft.com/windows/win32/intl/input-method-manager

use std::cell::{Cell, RefCell};
use std::ops::Range;

use super::window::Window;
use crate::input::TextInput;
use crate::win32::*;

#[derive(Default)]
pub struct InputMethod {
    pub has_changed: Cell<bool>,
    is_enabled: Cell<Option<bool>>,
    is_composing: Cell<bool>,
    told: RefCell<(String, Option<Range<usize>>)>,
    is_cancelling: Cell<bool>,
    has_caret: Cell<bool>,
}

struct Context(Handle, Handle);

impl Context {
    fn of(window: Handle) -> Context {
        Context(window, ImmGetContext(window))
    }

    fn bytes(&self, part: u32) -> Vec<u8> {
        // SAFETY: no buffer, and then one with its length.
        unsafe {
            let mut bytes = vec![
                0;
                ImmGetCompositionStringW(self.1, part, std::ptr::null_mut(), 0).max(0)
                    as usize
            ];
            ImmGetCompositionStringW(self.1, part, bytes.as_mut_ptr().cast(), bytes.len() as u32);
            bytes
        }
    }

    fn text(&self, part: u32) -> String {
        String::from_utf16_lossy(&units_in(&self.bytes(part)))
    }

    /// The clause that is being converted, or the caret.
    fn selection(&self, parts: u32) -> Option<Range<usize>> {
        let is_target =
            |it: &u8| [ATTR_TARGET_CONVERTED, ATTR_TARGET_NOTCONVERTED].contains(&u32::from(*it));
        let attributes = self.bytes(GCS_COMPATTR);
        let target = attributes.iter().position(is_target).map(|start| {
            start
                ..start
                    + attributes[start..]
                        .iter()
                        .take_while(|it| is_target(it))
                        .count()
        });
        // SAFETY: it needs no buffer.
        let caret = || {
            unsafe { ImmGetCompositionStringW(self.1, GCS_CURSORPOS, std::ptr::null_mut(), 0) }
                .max(0) as usize
        };
        target.or_else(|| {
            (parts & GCS_CURSORPOS != 0 && parts & CS_NOMOVECARET == 0)
                .then(caret)
                .map(|it| it..it)
        })
    }
}

impl Drop for Context {
    fn drop(&mut self) {
        ImmReleaseContext(self.0, self.1);
    }
}

impl Window {
    fn caret(&self) -> Option<DeviceRect> {
        let caret = TextInput(self.id).caret()?;
        let [left, top, right, bottom] = [
            caret.x,
            caret.y,
            caret.x + caret.width.max(1.),
            caret.y + caret.height,
        ]
        .map(|it| (it * self.scale()).round() as i32);
        Some(DeviceRect {
            left,
            top,
            right,
            bottom,
        })
    }

    fn cancel_composition(&self) {
        if self.ime.is_composing.take() {
            self.ime.is_cancelling.set(true);
            ImmNotifyIME(Context::of(self.handle).1, NI_COMPOSITIONSTR, CPS_CANCEL, 0);
            self.ime.is_cancelling.set(false);
        }
    }

    /// What is being composed stays as it is.
    pub fn end_composition(&self) {
        if self.ime.is_composing.get() {
            TextInput(self.id).end_composition();
            self.cancel_composition();
        }
    }

    pub fn forget_caret(&self) {
        if self.ime.has_caret.take() {
            DestroyCaret();
        }
    }

    pub fn update_input_method(&self) {
        let (state, input) = (&self.ime, TextInput(self.id));
        if !state.has_changed.take() {
            return;
        }
        if input.composing().is_none() {
            self.cancel_composition();
        }
        let is_enabled = input.is_enabled();
        if state.is_enabled.replace(Some(is_enabled)) != Some(is_enabled) {
            ImmAssociateContextEx(self.handle, 0, if is_enabled { IACE_DEFAULT } else { 0 });
        }
        let Some(caret) = self.caret().filter(|_| is_enabled && self.is_active.get()) else {
            return self.forget_caret();
        };
        // It is not shown. Some input methods and the magnifier follow it.
        if !state.has_caret.replace(true) {
            CreateCaret(self.handle, 0, 1, caret.height());
        }
        SetCaretPos(caret.left, caret.top);
        let (context, at) = (
            Context::of(self.handle),
            DevicePoint {
                x: caret.left,
                y: caret.top,
            },
        );
        ImmSetCompositionWindow(
            context.1,
            &CompositionForm {
                dw_style: CFS_POINT,
                pt_current_pos: at,
                ..Default::default()
            },
        );
        ImmSetCandidateWindow(
            context.1,
            &CandidateForm {
                dw_index: 0,
                dw_style: CFS_EXCLUDE,
                pt_current_pos: at,
                rc_area: caret,
            },
        );
    }

    pub fn composition_changed(&self, parts: u32) {
        let (context, input) = (Context::of(self.handle), TextInput(self.id));
        if self.ime.is_cancelling.get() {
            return;
        }
        if parts & GCS_RESULTSTR != 0 {
            self.ime.is_composing.set(false);
            input.insert(None, &context.text(GCS_RESULTSTR));
        }
        if parts & GCS_COMPSTR != 0 || parts == 0 {
            let now = (context.text(GCS_COMPSTR), context.selection(parts));
            if !self.ime.is_composing.replace(!now.0.is_empty()) || *self.ime.told.borrow() != now {
                input.compose(None, &now.0, now.1.clone());
                self.ime.told.replace(now);
            }
        }
    }

    pub fn composition_ended(&self) {
        // The one for Korean says that it has ended before it says with what.
        let next = super::keyboard::peek(
            self.handle,
            WM_IME_STARTCOMPOSITION,
            WM_IME_COMPOSITION,
            PM_NOREMOVE,
        );
        if next.is_some_and(|it| {
            it.message == WM_IME_COMPOSITION && it.l_param as u32 & GCS_RESULTSTR != 0
        }) {
            return;
        }
        if self.ime.is_composing.take() {
            TextInput(self.id).compose(None, "", None);
        }
    }

    /// # Safety
    /// `l` is what comes with that request.
    pub unsafe fn answer_input_method(&self, request: usize, l: isize) -> Option<isize> {
        const AROUND: usize = 200;
        let input = TextInput(self.id);
        if request == IMR_QUERYCHARPOSITION {
            let (caret, origin, client) = (self.caret()?, self.origin(), self.client_size());
            // SAFETY: the caller's contract.
            let answer = unsafe { &mut *(l as *mut ImeCharPosition) };
            answer.pt = DevicePoint {
                x: origin.x + caret.left,
                y: origin.y + caret.top,
            };
            answer.c_line_height = caret.height() as u32;
            answer.rc_document = DeviceRect {
                left: origin.x,
                top: origin.y,
                right: origin.x + client.0,
                bottom: origin.y + client.1,
            };
            return Some(1);
        }
        let target = input
            .composing()
            .or(input.selection())
            .filter(|_| input.is_enabled())?;
        let (text, range) = match request {
            IMR_RECONVERTSTRING if !target.is_empty() => input.text(target.clone())?,
            IMR_DOCUMENTFEED => {
                input.text(target.start.saturating_sub(AROUND)..target.end + AROUND)?
            }
            _ => return None,
        };
        let size = size_of::<ReconvertString>() + size_of_val(&text[..]);
        // SAFETY: as above. It says how much room there is, and is null if the question is how much it takes.
        unsafe {
            let Some(answer) = (l as *mut ReconvertString).as_mut() else {
                return Some(size as isize);
            };
            (answer.dw_size as usize >= size).then_some(())?;
            let (offset, length) = ((target.start - range.start) as u32 * 2, target.len() as u32);
            *answer = ReconvertString {
                dw_str_len: text.len() as u32,
                dw_str_offset: size_of::<ReconvertString>() as u32,
                dw_comp_str_len: length,
                dw_comp_str_offset: offset,
                dw_target_str_len: length,
                dw_target_str_offset: offset,
                ..*answer
            };
            (l as *mut ReconvertString)
                .add(1)
                .cast::<u16>()
                .copy_from_nonoverlapping(text.as_ptr(), text.len());
        }
        Some(size as isize)
    }
}
