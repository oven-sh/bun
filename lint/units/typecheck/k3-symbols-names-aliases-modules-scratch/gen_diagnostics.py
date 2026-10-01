# Writes the stand-in for crate::diagnostics of the scratch: one id per message name of the generated table, without the texts.
# usage: gen_diagnostics.py <diagnostics_generated.rs> > stubs/diagnostics.rs
import re, sys
names = re.findall(r"^    \(([A-Z0-9_]+),", open(sys.argv[1]).read(), re.M)
out = [
    "// Scratch stand-in for crate::diagnostics: the ids of the messages, without their texts.",
    "#[repr(transparent)]",
    "#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]",
    "pub struct MessageId(pub u32);",
    "impl MessageId {",
    "    pub const NIL: MessageId = MessageId(0);",
    "    pub const fn is_nil(self) -> bool { self.0 == 0 }",
    "}",
]
for i, n in enumerate(sorted(set(names))):
    out.append(f"pub const {n}: MessageId = MessageId({i + 1});")
print("\n".join(out))
