use crate::shell::builtin::Kind;
use crate::shell::builtins::basename::{PathBuiltin, PathTransform};

#[derive(Default)]
pub struct DirnameTransform;

impl PathTransform for DirnameTransform {
    const KIND: Kind = Kind::Dirname;
    fn apply(path: &[u8]) -> &[u8] {
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Posix>(path);
        if dir.is_empty() { b"." } else { dir }
    }
}

pub type Dirname = PathBuiltin<DirnameTransform>;
