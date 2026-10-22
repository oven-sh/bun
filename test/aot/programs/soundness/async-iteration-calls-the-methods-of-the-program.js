function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let log = "";
function note(x) { log += x; }
function take() { const l = log; log = ""; return l; }
function thenable(value) { return { then(resolve) { note("t"); resolve(value); } }; }
function kind(v) { return typeof v + " " + String(v); }
function source(values) {
  return {
    [Symbol.asyncIterator]() {
      note("o");
      let i = 0;
      return {
        next(sent) { note("n"); return thenable(i < values.length ? { done: false, value: values[i++] } : { done: true, value: "end" }); },
        return(v) { note("r"); return thenable({ done: true, value: v }); },
        throw(e) { note("x"); return thenable({ done: true, value: "thrown " + e }); },
      };
    },
  };
}

async function main() {
  for await (const v of source(["a", 1])) print("for await", kind(v), take());
  print("after", take());
  for await (const v of source(["b", "c"])) { print("break", kind(v), take()); break; }
  print("after break", take());
  try { for await (const v of source(["d"])) throw "boom"; } catch (e) { print("throw", kind(e), take()); }

  async function* delegate() { const r = yield* source(["e", "f"]); print("delegate ends with", kind(r), take()); return "done"; }
  for await (const v of delegate()) print("yield*", kind(v), take());
  const it = delegate();
  print("first", kind((await it.next()).value), take());
  print("return through yield*", kind((await it.return("early")).value), take());
  const it2 = delegate();
  await it2.next(); take();
  print("throw through yield*", kind((await it2.throw("late")).value), take());

  async function* fromSync() { yield* [thenable("g"), "h"]; }
  for await (const v of fromSync()) print("yield* of a list", kind(v), take());

  const syncWithReturn = { [Symbol.iterator]() { note("O"); return { next() { note("N"); return { done: false, value: thenable("i") }; }, return() { note("R"); return {}; } }; } };
  for await (const v of syncWithReturn) { print("from sync", kind(v), take()); break; }
  print("from sync closed", take());

  const values = await Array.fromAsync(source(["j", 2]));
  print("fromAsync", values.map(kind).join("; "), take());

  const rejecting = { [Symbol.asyncIterator]() { return { next() { return { then(a, b) { note("T"); b("no"); } }; } }; } };
  try { for await (const v of rejecting) print("never"); } catch (e) { print("rejected", kind(e), take()); }

  const notAnObject = { [Symbol.asyncIterator]() { return { next() { return thenable(5); } }; } };
  try { for await (const v of notAnObject) print("never"); } catch (e) { print("bad result", e instanceof TypeError, take()); }
}
main().catch(e => print("failed", String(e)));
