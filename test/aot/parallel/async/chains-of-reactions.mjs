// STATISTIC: ReactionChainsBuilt >= 15
// Closures that only a chain of then and catch takes, and the promises between its ends, are one cell.
import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(String(text));
const storage = new AsyncLocalStorage();
const nothing = () => Promise.resolve(undefined);
const later = value => new Promise(resolve => setImmediate(() => resolve(value)));
const fails = text => new Promise((_, reject) => setImmediate(() => reject(new Error(text))));
const thenable = value => ({ then(f) { log("thenable"); f(value); } });
class Below extends Promise {}

async function ticks(name, count) {
  for (let tick = 0; tick < count; tick++) {
    await 0;
    log(name + tick);
  }
}

// What the handlers return, by the jobs that it takes.
function returned(a, b) {
  let c = 0, d = "d";
  return nothing()
    .then(v => { c = a; return a + 1; })
    .then(v => (log("a" + v + b), nothing()))
    .then(v => { log("b" + v); d += b; return Promise.resolve(c); })
    .then(v => (log("c" + v + d), thenable(v)))
    .then(v => (log("d" + v), later(v + a)))
    .then(v => (log("e" + v + b + c), Promise.resolve(v).then(w => w + a).then(w => [w, d])))
    .then(v => (log("f" + v), Below.resolve(v.length)))
    .catch(e => log("no " + e))
    .then(v => "returned " + v + a + b + c + d);
}

function rejected(a) {
  const error = new Error("thrown " + a);
  return later(a)
    .then(v => { if (v === a) throw error; return 1; })
    .then(v => log("skipped"))
    .then(v => log("skipped"))
    .catch(e => (log(e.message + (e === error)), Promise.reject(new TypeError("again " + a))))
    .catch(e => (log(e.message), a))
    .then(v => fails("later " + v))
    .catch(e => e.message + a);
}

function longer(a) {
  let steps = "";
  return Promise.resolve(a)
    .then(v => { steps += "1"; return v; })
    .then(v => { steps += "2"; return v; })
    .then(v => { steps += "3"; return v; })
    .then(v => { steps += "4"; return v; })
    .then(v => { steps += "5"; return v; })
    .then(v => { steps += "6"; return v; })
    .then(v => { steps += "7"; return v; })
    .then(v => { steps += "8"; return v; })
    .then(v => { steps += "9"; return v; })
    .then(v => steps + v)
    .catch(() => "no");
}

function captured(a, b, c, d, e) {
  let f = a, g = b;
  return nothing()
    .then(() => { f += c; return [a, b, c]; })
    .then(v => { g += d; return [...v, d, e, f]; })
    .then(v => [...v, f, g, a, e].join());
}

function* receivers(a) {
  yield Promise.resolve(a);
  yield Promise.reject(new Error("rejected"));
  yield later(a);
  yield fails("failed");
  yield new Below(resolve => resolve(a));
  const own = Promise.resolve(a);
  own.then = function (f, r) { log("own then"); return Promise.prototype.then.call(this, f, r); };
  yield own;
  const seen = Promise.resolve(a);
  seen.then(v => log("seen " + v));
  yield seen;
  const pending = later(a);
  pending.then(v => log("pending " + v));
  yield pending;
}

function onto(receiver, a) {
  return receiver.then(v => (log("onto " + v), v + a)).then(v => v + 1).catch(e => e.message + a);
}

async function inLoops() {
  const all = [];
  for (let k = 0; k < 30; k++) {
    let seen = 0;
    all.push(nothing().then(() => { seen = k; return k % 3 ? k : Promise.resolve(k); }).then(v => { if (v % 5 === 4) throw new Error("five " + v); return v + seen; }).catch(e => e.message + seen));
  }
  log((await Promise.all(all)).join());
  let last;
  for (let k = 0; k < 3; k++) last = Promise.resolve(last).then(v => [v, k]).then(v => JSON.stringify(v));
  log(await last);
}

async function contexts() {
  await storage.run("a", async () => {
    const promise = nothing().then(() => { log("context " + storage.getStore()); return later(1); }).then(v => { storage.enterWith("b"); return v; }).then(v => storage.getStore() + v);
    storage.enterWith("c");
    log(await promise + storage.getStore());
  });
  const outside = nothing().then(() => storage.run("d", () => Promise.resolve(storage.getStore()))).then(v => v + storage.getStore()).catch(() => "no");
  log(await outside);
}

function trace(error) {
  return error.stack.split("\n").slice(1).map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/]+?)\)?$/, "$1")).join(" | ");
}
async function traces(a) {
  log(await nothing().then(function first() { return trace(new Error("first")) + a; }).then(v => v + trace(new Error("second"))));
  try {
    await nothing().then(() => later(a)).then(v => { throw new Error("traced " + v); });
  } catch (error) {
    log(error.message + trace(error));
  }
}

process.on("unhandledRejection", error => log("unhandled " + error.message));
await Promise.all([returned(3, "b").then(log), ticks("t", 40)]);
await Promise.all([rejected(4).then(log), ticks("u", 20)]);
log(await longer(5));
log(await captured(1, 2, 3, 4, 5));
for (const receiver of receivers(6)) log(await onto(receiver, 7));
await Promise.all([inLoops(), ticks("v", 12)]);
await contexts();
await traces(8);
void nothing().then(() => { throw new Error("nobody"); }).then(() => 1);
await later(0);
await later(0);
console.log(out.join("\n"));
