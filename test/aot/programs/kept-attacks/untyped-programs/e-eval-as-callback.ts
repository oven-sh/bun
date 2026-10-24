// Untyped programs: e eval as callback. It prints what plain Bun prints.
type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const chosen: Callback = process.argv.length > 99 ? text => text.length : eval;
console.log(run(chosen, process.argv.length > 99 ? "0" : "1 + 2"));
