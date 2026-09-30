// internal/core/scripttarget_stringer_generated.go: the String method that stringer generates for ScriptTarget, without the prefix ScriptTarget.
use crate::core::compileroptions::ScriptTarget;

const SCRIPT_TARGET_NAME_0: &[u8] =
    b"NoneES5ES2015ES2016ES2017ES2018ES2019ES2020ES2021ES2022ES2023ES2024ES2025";
const SCRIPT_TARGET_NAME_1: &[u8] = b"ESNextJSON";

const SCRIPT_TARGET_INDEX_0: [u8; 14] = [0, 4, 7, 13, 19, 25, 31, 37, 43, 49, 55, 61, 67, 73];
const SCRIPT_TARGET_INDEX_1: [u8; 3] = [0, 6, 10];

fn name(names: &'static [u8], index: &[u8], i: i32) -> Option<&'static [u8]> {
    let idx = usize::try_from(i).ok()?;
    names.get(usize::from(*index.get(idx)?)..usize::from(*index.get(idx + 1)?))
}

impl ScriptTarget {
    pub fn string(self) -> Vec<u8> {
        let i = self.0;
        let found = if (0..=12).contains(&i) {
            name(SCRIPT_TARGET_NAME_0, &SCRIPT_TARGET_INDEX_0, i)
        } else if (99..=100).contains(&i) {
            name(SCRIPT_TARGET_NAME_1, &SCRIPT_TARGET_INDEX_1, i - 99)
        } else {
            None
        };
        match found {
            Some(name) => name.to_vec(),
            None => format!("ScriptTarget({i})").into_bytes(),
        }
    }
}
