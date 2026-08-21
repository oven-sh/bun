// bun_js_parser's repl_mode (src/js_parser/repl_transforms.rs) already
// implements Node's processTopLevelAwait rewrite natively, so this module
// re-exports the Bun.Transpiler-backed helper from native-parse.
const { processTopLevelAwait } = require("internal/repl/native-parse");

export default { processTopLevelAwait };
