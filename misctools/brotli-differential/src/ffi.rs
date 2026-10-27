#![allow(non_camel_case_types, dead_code)]
use std::ffi::{c_char, c_int, c_void};

pub enum BrotliDecoderState {}
pub enum BrotliEncoderState {}
pub enum BrotliEncoderPreparedDictionary {}

unsafe extern "C" {
    pub fn BrotliDecoderCreateInstance(a: *const c_void, f: *const c_void, o: *mut c_void) -> *mut BrotliDecoderState;
    pub fn BrotliDecoderDestroyInstance(s: *mut BrotliDecoderState);
    pub fn BrotliDecoderSetParameter(s: *mut BrotliDecoderState, p: c_int, v: u32) -> c_int;
    pub fn BrotliDecoderAttachDictionary(s: *mut BrotliDecoderState, t: c_int, n: usize, d: *const u8) -> c_int;
    pub fn BrotliDecoderDecompressStream(
        s: *mut BrotliDecoderState,
        available_in: *mut usize,
        next_in: *mut *const u8,
        available_out: *mut usize,
        next_out: *mut *mut u8,
        total_out: *mut usize,
    ) -> c_int;
    pub fn BrotliDecoderHasMoreOutput(s: *const BrotliDecoderState) -> c_int;
    pub fn BrotliDecoderIsUsed(s: *const BrotliDecoderState) -> c_int;
    pub fn BrotliDecoderIsFinished(s: *const BrotliDecoderState) -> c_int;
    pub fn BrotliDecoderGetErrorCode(s: *const BrotliDecoderState) -> c_int;
    pub fn BrotliDecoderErrorString(c: c_int) -> *const c_char;

    pub fn BrotliEncoderCreateInstance(a: *const c_void, f: *const c_void, o: *mut c_void) -> *mut BrotliEncoderState;
    pub fn BrotliEncoderDestroyInstance(s: *mut BrotliEncoderState);
    pub fn BrotliEncoderSetParameter(s: *mut BrotliEncoderState, p: c_int, v: u32) -> c_int;
    pub fn BrotliEncoderMaxCompressedSize(n: usize) -> usize;
    pub fn BrotliEncoderCompress(
        quality: c_int,
        lgwin: c_int,
        mode: c_int,
        input_size: usize,
        input: *const u8,
        encoded_size: *mut usize,
        encoded: *mut u8,
    ) -> c_int;
    pub fn BrotliEncoderCompressStream(
        s: *mut BrotliEncoderState,
        op: c_int,
        available_in: *mut usize,
        next_in: *mut *const u8,
        available_out: *mut usize,
        next_out: *mut *mut u8,
        total_out: *mut usize,
    ) -> c_int;
    pub fn BrotliEncoderIsFinished(s: *mut BrotliEncoderState) -> c_int;
    pub fn BrotliEncoderHasMoreOutput(s: *mut BrotliEncoderState) -> c_int;
    pub fn BrotliEncoderPrepareDictionary(
        t: c_int,
        n: usize,
        d: *const u8,
        quality: c_int,
        a: *const c_void,
        f: *const c_void,
        o: *mut c_void,
    ) -> *mut BrotliEncoderPreparedDictionary;
    pub fn BrotliEncoderDestroyPreparedDictionary(d: *mut BrotliEncoderPreparedDictionary);
    pub fn BrotliEncoderAttachPreparedDictionary(
        s: *mut BrotliEncoderState,
        d: *const BrotliEncoderPreparedDictionary,
    ) -> c_int;
}

/// Parameters for a C-encoded stream.
#[derive(Clone, Debug, Default)]
pub struct EncParams {
    pub params: Vec<(i32, u32)>,
    pub dict: Option<Vec<u8>>,
}

pub struct CEncoder {
    pub s: *mut BrotliEncoderState,
    dicts: Vec<*mut BrotliEncoderPreparedDictionary>,
    _dict_data: Vec<Vec<u8>>,
}

impl CEncoder {
    pub fn new() -> Self {
        let s = unsafe { BrotliEncoderCreateInstance(std::ptr::null(), std::ptr::null(), std::ptr::null_mut()) };
        assert!(!s.is_null());
        Self { s, dicts: Vec::new(), _dict_data: Vec::new() }
    }
    pub fn set(&mut self, p: i32, v: u32) -> bool {
        unsafe { BrotliEncoderSetParameter(self.s, p, v) != 0 }
    }
    pub fn attach(&mut self, data: Vec<u8>) -> bool {
        let d = unsafe {
            BrotliEncoderPrepareDictionary(0, data.len(), data.as_ptr(), 11, std::ptr::null(), std::ptr::null(), std::ptr::null_mut())
        };
        if d.is_null() {
            return false;
        }
        self.dicts.push(d);
        self._dict_data.push(data);
        unsafe { BrotliEncoderAttachPreparedDictionary(self.s, d) != 0 }
    }
    /// Returns (ok, consumed, produced).
    pub fn stream(&mut self, op: i32, input: &[u8], out: &mut [u8]) -> (bool, usize, usize) {
        let mut avail_in = input.len();
        let mut next_in = input.as_ptr();
        let mut avail_out = out.len();
        let mut next_out = out.as_mut_ptr();
        let ok = unsafe {
            BrotliEncoderCompressStream(self.s, op, &mut avail_in, &mut next_in, &mut avail_out, &mut next_out, std::ptr::null_mut())
        };
        (ok != 0, input.len() - avail_in, out.len() - avail_out)
    }
    pub fn is_finished(&mut self) -> bool {
        unsafe { BrotliEncoderIsFinished(self.s) != 0 }
    }
    pub fn has_more_output(&mut self) -> bool {
        unsafe { BrotliEncoderHasMoreOutput(self.s) != 0 }
    }
}

impl Drop for CEncoder {
    fn drop(&mut self) {
        unsafe {
            BrotliEncoderDestroyInstance(self.s);
            for &d in &self.dicts {
                BrotliEncoderDestroyPreparedDictionary(d);
            }
        }
    }
}

/// Whole-buffer compression through the C streaming API.
pub fn c_compress(data: &[u8], p: &EncParams) -> Vec<u8> {
    let mut e = CEncoder::new();
    for &(k, v) in &p.params {
        e.set(k, v);
    }
    if let Some(d) = &p.dict {
        assert!(e.attach(d.clone()));
    }
    let mut out = Vec::new();
    let mut buf = vec![0u8; 1 << 16];
    let mut input = data;
    loop {
        let (ok, used, made) = e.stream(2, input, &mut buf);
        assert!(ok);
        input = &input[used..];
        out.extend_from_slice(&buf[..made]);
        if e.is_finished() {
            return out;
        }
    }
}

pub struct CDecoder {
    pub s: *mut BrotliDecoderState,
    _dicts: Vec<Vec<u8>>,
}

impl CDecoder {
    pub fn new() -> Self {
        let s = unsafe { BrotliDecoderCreateInstance(std::ptr::null(), std::ptr::null(), std::ptr::null_mut()) };
        assert!(!s.is_null());
        Self { s, _dicts: Vec::new() }
    }
    pub fn set(&mut self, p: i32, v: u32) -> bool {
        unsafe { BrotliDecoderSetParameter(self.s, p, v) != 0 }
    }
    pub fn attach(&mut self, data: Vec<u8>) -> bool {
        let ok = unsafe { BrotliDecoderAttachDictionary(self.s, 0, data.len(), data.as_ptr()) != 0 };
        self._dicts.push(data);
        ok
    }
    /// Returns (result, consumed, produced).
    pub fn stream(&mut self, input: &[u8], out: &mut [u8]) -> (i32, usize, usize) {
        let mut avail_in = input.len();
        let mut next_in = input.as_ptr();
        let mut avail_out = out.len();
        let mut next_out = out.as_mut_ptr();
        let r = unsafe {
            BrotliDecoderDecompressStream(self.s, &mut avail_in, &mut next_in, &mut avail_out, &mut next_out, std::ptr::null_mut())
        };
        (r, input.len() - avail_in, out.len() - avail_out)
    }
    pub fn error_code(&self) -> i32 {
        unsafe { BrotliDecoderGetErrorCode(self.s) }
    }
    pub fn has_more_output(&self) -> bool {
        unsafe { BrotliDecoderHasMoreOutput(self.s) != 0 }
    }
    pub fn is_used(&self) -> bool {
        unsafe { BrotliDecoderIsUsed(self.s) != 0 }
    }
    pub fn is_finished(&self) -> bool {
        unsafe { BrotliDecoderIsFinished(self.s) != 0 }
    }
}

impl Drop for CDecoder {
    fn drop(&mut self) {
        unsafe { BrotliDecoderDestroyInstance(self.s) }
    }
}
