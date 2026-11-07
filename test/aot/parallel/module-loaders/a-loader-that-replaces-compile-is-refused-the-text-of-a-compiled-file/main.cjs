// A loader that wraps module._compile wants the source text of the file. An executable holds the file compiled, without its text, so the default loader refuses aloud.
// `bun run` and an executable of `bun build --compile` hand it the text and print 42. The expected output is written down.
const original = require.extensions[".js"];
require.extensions[".js"] = function (module, filename) {
  const compile = module._compile;
  module._compile = function (code, name) {
    return compile.call(this, code.replace("41", "42"), name);
  };
  return original(module, filename);
};
if (process.argv.length > 99) require("./subject.js");
try {
  console.log(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js").value);
} catch (error) {
  console.log(error.message.split(":")[0].replace(/'.*'/, "'<path>'"));
}
/* Output:
Cannot hand the source text of '<path>' to module._compile
*/
