// Functions that test the generator they are passed before they iterate it, while the program changes what the tests look at.
const log = [];
let seen, flag = false;
class Own {}
function* count(from, to) { for (let i = from; i <= to; i++) yield i; }
function* guarded(from, to) { try { for (let i = from; i <= to; i++) yield i; } finally { log.push("closed"); } }
function* failing(from, to) { for (let i = from; i <= to; i++) { if (i === from + 3) throw new Error("at " + i); yield i; } }
function isAsync(input) { if (typeof input !== "object" || input === null) return false; return input[Symbol.asyncIterator] !== undefined; }
function every(data, test) {
  if (data == null) return "nothing";
  if (isAsync(data) || data instanceof Promise) return (async () => { for await (const x of data) if (!test(x)) return false; return true; })();
  let i = 0;
  for (const x of data) { if (!test(x, i++)) return false; }
  return true;
}
function sum(data) { if (data instanceof Own) return "own"; if (flag) seen = data; let s = 0; for (const x of data) { s += x; if (seen) { const r = seen.next(); log.push(String(r.value)); } } return s; }
function filled(data) { if (Array.isArray(data)) return data.length; if (data.length !== undefined) return "has a length"; let s = ""; for (const x of data) { if (x > 6) break; s += x; } return s; }
function kept(test) { return function (data) { if (!data) return "none"; if (typeof data === "string") return "text"; let n = 0; for (const x of data) if (test(x)) n++; return n; }; }

const cases = {
  everyCount: n => every(count(2, n), x => x < 9),
  everyGuarded: n => every(guarded(2, n), x => x < 7),
  everyFailing: n => every(failing(1, n), x => x > 0),
  everyThrows: n => every(count(1, n), x => { if (x === 5) throw new TypeError("test " + x); return true; }),
  sumCount: n => sum(count(1, n)),
  sumGuarded: n => sum(guarded(1, n)),
  filledCount: n => filled(count(1, n)),
  filledGuarded: n => filled(guarded(1, n)),
  kept: n => kept(x => x % 2)(count(0, n)),
  keptFailing: n => kept(x => x % 2)(failing(0, n)),
};
function run(title) {
  for (const name in cases) {
    for (const n of [0, 1, 3, 8, 12]) {
      let result;
      try { result = cases[name](n); } catch (error) { result = error.name + ": " + error.message; }
      console.log(title, name, n, typeof result === "object" ? "promise" : result, log.join(" "));
      log.length = 0;
    }
  }
}
run("plain");
for (let i = 0; i < 300; i++) for (const name in cases) try { cases[name](i % 11); } catch {}
log.length = 0;
flag = true; run("kept"); flag = false; seen = undefined;
count.prototype[Symbol.asyncIterator] = undefined; run("async name");
Object.defineProperty(count.prototype, Symbol.asyncIterator, { get() { log.push("steps " + this.next().value); }, configurable: true }); run("async getter");
delete count.prototype[Symbol.asyncIterator];
count.prototype.length = 2; run("length");
delete count.prototype.length;
guarded.prototype.next = function () { log.push("own next"); return { done: true }; }; run("own next");
delete guarded.prototype.next;
failing.prototype[Symbol.iterator] = function* () { yield 40; yield 50; }; run("own iterator");
Object.setPrototypeOf(count.prototype, Own.prototype); run("own class");
count.prototype = null; run("no prototype");
const RealPromise = Promise;
globalThis.Promise = class { static [Symbol.hasInstance](x) { log.push("asked"); return false; } }; run("promise");
globalThis.Promise = RealPromise;
Object.defineProperty(globalThis, "Promise", { get() { log.push("read"); return RealPromise; }, configurable: true }); run("promise getter");
