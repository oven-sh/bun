use crate::id::StrId;
use crate::ir::{Def, Op, Program};
use std::collections::BTreeSet;
use std::path::Path;

const WASM_MAGIC: &[u8] = b"\0asm\x01\0\0\0";
const MAX_PARENT_FOLDERS: usize = 4;

fn may_be_wasm_path(text: &[u8]) -> bool {
    text.len() > b".wasm".len() && text.len() <= 1024 && text.ends_with(b".wasm") && !bun_core::strings::contains_char(text, 0)
}

pub(crate) fn add_referenced_files(program: &mut Program) {
    let may_name: Vec<bool> = (0..program.strs.len()).map(|index| may_be_wasm_path(program.strs.get(StrId::new(index)))).collect();
    if !may_name.contains(&true) {
        return;
    }
    let mut named: BTreeSet<(&[u8], &[u8])> = BTreeSet::new();
    for func in program.funcs.iter().filter(|func| func.module.idx() < program.modules.len()) {
        for value in &func.values {
            if let Def::Op(Op::Str(text)) = &value.def
                && may_name[text.idx()]
            {
                named.insert((program.strs.get(program.modules[func.module.idx()].path), program.strs.get(*text)));
            }
        }
    }
    let mut found: Vec<Vec<u8>> = Vec::new();
    for (module, name) in named {
        let (Ok(module), Ok(name)) = (std::str::from_utf8(module), std::str::from_utf8(name)) else { continue };
        let read = (Path::new(module).ancestors().skip(1).take(MAX_PARENT_FOLDERS)).find_map(|folder| bun_sys::File::read_from(bun_sys::Fd::cwd(), folder.join(name).as_os_str().as_encoded_bytes()).ok());
        if let Some(bytes) = read.filter(|bytes| bytes.starts_with(WASM_MAGIC) && !found.contains(bytes)) {
            found.push(bytes);
        }
    }
    program.webassembly_modules = found;
}
