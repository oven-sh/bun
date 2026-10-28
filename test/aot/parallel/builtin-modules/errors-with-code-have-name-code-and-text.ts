// An error that a module of the library makes with a code: its kind, name, code, message and text, for refused values of every sort; and a warning written through a replaced process.stderr.write.
import fs from "node:fs";
import util from "node:util";
function show(label: string, e: any) {
  console.log(label, e.name, e.code, e.message, String(e), e.toString(), Object.prototype.hasOwnProperty.call(e, "code"),
    e instanceof TypeError, e instanceof RangeError, e instanceof Error, Object.keys(e).join(), typeof e.stack, Object.getPrototypeOf(e) === TypeError.prototype);
}
function attempt(label: string, run: () => unknown) {
  try { console.log(label, "answered", run()); } catch (e) { show(label, e); }
}
attempt("tick", () => process.nextTick(1 as any));
attempt("tick-object", () => process.nextTick({ toString() { return "never called"; } } as any));
attempt("read", () => fs.readFileSync(1.5 as any));
attempt("open", () => fs.openSync({} as any, "r"));
attempt("encoding", () => fs.readFileSync(import.meta.path, "nope" as any));
attempt("promisify", () => util.promisify(5 as any));
attempt("inherits", () => util.inherits(1 as any, 2 as any));
attempt("format", () => util.styleText("nope" as any, "x"));
attempt("url", () => new URL("nope"));
// A number that no process has, and signal 0, which only asks whether the process is there.
attempt("kill", () => process.kill(2147483646.5 as any, 0));
attempt("chdir", () => process.chdir(5 as any));
attempt("abort", () => { const c = new AbortController(); c.abort(); c.signal.throwIfAborted(); });
attempt("aborted", () => util.aborted(1 as any, {}));
class Odd { get [Symbol.toStringTag]() { return "Odd!"; } [util.inspect.custom]() { return "custom text"; } }
attempt("odd", () => process.nextTick(new Odd() as any));
attempt("odd-read", () => fs.readFileSync(new Odd() as any));
// The printer of warnings writes through process.stderr once the program has replaced its `write`, and drops what that answers.
const basename = process.argv0.split(/[\\/]/).pop()!;
process.stderr.write = ((text: string) => {
  console.log("written", JSON.stringify(text.replace(String(process.pid), "PID").replace(/`\S+ --trace-warnings/, "`EXE --trace-warnings")));
  return { odd: "answer" };
}) as any;
process.on("warning", w => console.log("warning seen", w.name, w.message, (w as any).code));
process.emitWarning("first", "CustomWarning", "C1");
process.emitWarning(new Error("second"));
void basename;
