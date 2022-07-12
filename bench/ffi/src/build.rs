#[cfg(feature="napi")] extern crate napi_build;

fn main() {
  #[cfg(feature="napi")] napi_build::setup();
}