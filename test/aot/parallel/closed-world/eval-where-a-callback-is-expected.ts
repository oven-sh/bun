// eval stands where a position of a function type expects a callback of the program.
type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const chosen: Callback = process.argv.length > 99 ? text => text.length : eval;
console.log(run(chosen, process.argv.length > 99 ? "0" : "1 + 2"));
const loose: any = process.argv.length > 99 ? (text: string) => text.length : eval;
console.log(run(loose, process.argv.length > 99 ? "0" : "3 + 4"));
