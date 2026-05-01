#[cfg(feature="enable-napi")] extern crate napi_build;

fn main() {
  #[cfg(feature="enable-napi")] napi_build::setup();
}