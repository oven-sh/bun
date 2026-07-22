//! The renderers' shared output sink. Allocation failure while rendering is
//! recorded in [`OutputBuffer::oom`] instead of aborting; the render entry
//! points (`render_to_html`, `render_to_ansi`) turn the flag into
//! `ParserError::OutOfMemory`. Staging buffers that hold output-sized data
//! before it reaches the sink must grow through [`try_extend`] / [`try_push`]
//! so their failures land on the same flag.

pub struct OutputBuffer {
    pub(crate) list: Vec<u8>,
    pub(crate) oom: bool,
}

impl OutputBuffer {
    pub(crate) fn write(&mut self, data: &[u8]) {
        if self.oom {
            return;
        }
        if self.list.try_reserve(data.len()).is_err() {
            self.oom = true;
            return;
        }
        self.list.extend_from_slice(data);
    }

    pub(crate) fn write_byte(&mut self, b: u8) {
        if self.oom {
            return;
        }
        if self.list.try_reserve(1).is_err() {
            self.oom = true;
            return;
        }
        self.list.push(b);
    }
}

/// Grow `buf` by `data` without aborting on allocation failure; the failure
/// is recorded in `oom` and further writes become no-ops.
pub(crate) fn try_extend(oom: &mut bool, buf: &mut Vec<u8>, data: &[u8]) {
    if *oom {
        return;
    }
    if buf.try_reserve(data.len()).is_err() {
        *oom = true;
        return;
    }
    buf.extend_from_slice(data);
}

/// [`try_extend`] for a single element.
pub(crate) fn try_push<T>(oom: &mut bool, vec: &mut Vec<T>, value: T) {
    if *oom {
        return;
    }
    if vec.try_reserve(1).is_err() {
        *oom = true;
        return;
    }
    vec.push(value);
}
