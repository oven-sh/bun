// Untyped programs: e eval through any. It prints what plain Bun prints.
type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const loose: any = process.argv.length > 99 ? (text: string) => text.length : eval;
console.log(run(loose, process.argv.length > 99 ? "0" : "1 + 2"));
