// internal/core/modulekind_stringer_generated.go: the String method that stringer generates for ModuleKind, without the prefix ModuleKind.
use crate::core::compileroptions::ModuleKind;

const MODULE_KIND_NAME_0: &[u8] = b"NoneCommonJSAMDUMDSystemES2015ES2020ES2022";
const MODULE_KIND_NAME_1: &[u8] = b"ESNextNode16Node18Node20";
const MODULE_KIND_NAME_2: &[u8] = b"NodeNextPreserve";

const MODULE_KIND_INDEX_0: [u8; 9] = [0, 4, 12, 15, 18, 24, 30, 36, 42];
const MODULE_KIND_INDEX_1: [u8; 5] = [0, 6, 12, 18, 24];
const MODULE_KIND_INDEX_2: [u8; 3] = [0, 8, 16];

fn name(names: &'static [u8], index: &[u8], i: i32) -> Option<&'static [u8]> {
    let idx = usize::try_from(i).ok()?;
    names.get(usize::from(*index.get(idx)?)..usize::from(*index.get(idx + 1)?))
}

impl ModuleKind {
    pub fn string(self) -> Vec<u8> {
        let i = self.0;
        let found = if (0..=7).contains(&i) {
            name(MODULE_KIND_NAME_0, &MODULE_KIND_INDEX_0, i)
        } else if (99..=102).contains(&i) {
            name(MODULE_KIND_NAME_1, &MODULE_KIND_INDEX_1, i - 99)
        } else if (199..=200).contains(&i) {
            name(MODULE_KIND_NAME_2, &MODULE_KIND_INDEX_2, i - 199)
        } else {
            None
        };
        match found {
            Some(name) => name.to_vec(),
            None => format!("ModuleKind({i})").into_bytes(),
        }
    }
}
