//! The modules of WebAssembly that a program loads from files. The engine compiles them with the program.

use crate::id::StrId;
use crate::ir::{Def, Op, Program};
use std::collections::BTreeSet;
use std::path::Path;

const START_OF_A_MODULE: &[u8] = b"\0asm\x01\0\0\0";
const FOLDERS_LOOKED_IN: usize = 4;

fn may_name_a_file(text: &[u8]) -> bool {
    text.len() > b".wasm".len() && text.len() <= 1024 && text.ends_with(b".wasm") && !text.contains(&0)
}

/// A text that ends in `.wasm` names a file where there is one by that path from the folder of the module that the text stands in, or
/// from one of the folders around it. No fact about what the program loads: bytes that are not among these are a module all the same.
pub(crate) fn add_files_named_in(program: &mut Program) {
    let may_name: Vec<bool> = (0..program.strs.len()).map(|index| may_name_a_file(program.strs.get(StrId::new(index)))).collect();
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
        let read = (Path::new(module).ancestors().skip(1).take(FOLDERS_LOOKED_IN)).find_map(|folder| std::fs::read(folder.join(name)).ok());
        if let Some(bytes) = read.filter(|bytes| bytes.starts_with(START_OF_A_MODULE) && !found.contains(bytes)) {
            found.push(bytes);
        }
    }
    program.webassembly_modules = found;
}
