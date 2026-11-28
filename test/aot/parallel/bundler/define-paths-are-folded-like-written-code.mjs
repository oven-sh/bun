// Flags: --minify-syntax --define=MODULE=names.module --define=SIZE=word.length --define=JOIN=path.posix.join --define=DEEP=local.a.b --define=app=logger --drop=app.debug
// Reference: bun build --compile
import * as names from "./define-paths-begin-at-names-of-the-file/esm.mjs";
import path from "node:path";
function size() { const word = "abc"; return SIZE === 3 ? "three" : "other"; }
const local = { a: undefined };
const logger = { debug: { "a-b": it => console.log(it) } };
app.debug["a-b"]("kept");
app.debug.other("dropped");
try { DEEP; } catch (e) { console.log(e.message); }
console.log(typeof (await import(MODULE)).default, size(), JOIN("a", "b"));
