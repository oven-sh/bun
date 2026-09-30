// internal/core/scriptkind_stringer_generated.go: the String method that stringer generates for ScriptKind.
use crate::core::scriptkind::ScriptKind;

const SCRIPT_KIND_NAME_0: &[u8] =
    b"ScriptKindUnknownScriptKindJSScriptKindJSXScriptKindTSScriptKindTSX";
const SCRIPT_KIND_NAME_1: &[u8] = b"ScriptKindJSON";

const SCRIPT_KIND_INDEX_0: [u8; 6] = [0, 17, 29, 42, 54, 67];

impl ScriptKind {
    pub fn string(self) -> Vec<u8> {
        let i = self.0;
        if (0..=4).contains(&i) {
            let idx = i as usize;
            if let (Some(&start), Some(&end)) = (
                SCRIPT_KIND_INDEX_0.get(idx),
                SCRIPT_KIND_INDEX_0.get(idx + 1),
            ) {
                let name = SCRIPT_KIND_NAME_0.get(usize::from(start)..usize::from(end));
                return name.unwrap_or(&[]).to_vec();
            }
        }
        if i == 6 {
            return SCRIPT_KIND_NAME_1.to_vec();
        }
        format!("ScriptKind({i})").into_bytes()
    }
}
