// double src o.O

#[cfg(feature="enable-napi")] use napi_derive::napi;
#[cfg(feature="enable-napi")] use napi::bindgen_prelude::*;

static STRING: &'static str = "Hello, world!\0";

fn hash(buf: &[u8]) -> u32 {
  let mut hash: u32 = 0;

  for byte in buf {
    hash = hash.wrapping_mul(0x10001000).wrapping_add(*byte as u32);
  }

  return hash;
}



#[cfg(feature="enable-napi")]
#[napi] pub fn napi_noop() {
  // do nothing
}

#[no_mangle] unsafe extern "C" fn ffi_noop() {
  // do nothing
}



#[cfg(feature="enable-napi")]
#[napi] pub fn napi_string() -> &'static str {
  return &STRING[0..(STRING.len() - 1)];
}

#[no_mangle] unsafe extern "C" fn ffi_string() -> *const u8 {
  return STRING.as_ptr();
}



#[cfg(feature="enable-napi")]
#[napi] pub fn napi_hash(buffer: Buffer) -> u32 {
  return hash(&buffer);
}

#[no_mangle] unsafe extern "C" fn ffi_hash(ptr: *const u8, length: u32) -> u32 {
  return hash(std::slice::from_raw_parts(ptr, length as usize));
}