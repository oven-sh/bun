// A direct eval of a text that the build cannot know is the first read of a default import of node:zlib and of a namespace of node:os.
import zlib from "node:zlib";
import * as os from "node:os";
function evaluate(code) {
  return eval(code);
}
// Zero, which the build cannot know: a text that is cut there is made at the run.
const cut = process.argv.length - process.argv.length;
console.log(
  evaluate("typeof zlib.gzipSync".slice(cut)),
  evaluate("typeof os.EOL".slice(cut)),
  evaluate("Object.keys(os).includes('platform')".slice(cut)),
);
console.log(typeof zlib.gunzipSync, typeof os.platform);
