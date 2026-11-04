// A generator that iterations alone take is made without the object under `prototype` of its function. Each road by which somebody could tell is walked here, beside a function of the same text that nobody asks.
const log = [];
function* plain(n) { for (let i = 0; i < n; i++) yield i; }
for (const x of plain(3)) log.push(x);
log.push(...plain(2));
const [first, second] = plain(5);
log.push(first, second);
function* outer() { yield* plain(2); yield "end"; }
for (const x of outer()) log.push(x);
console.log(log.join(","));

// The generator is held.
function* held(n) { for (let i = 0; i < n; i++) yield i; }
const generator = held(2);
console.log(Object.getPrototypeOf(generator) === held.prototype, Object.getPrototypeOf(held.prototype) === Object.getPrototypeOf(plainPrototype()), [...generator].join(","));
function plainPrototype() { function* other() {} return other.prototype; }

// The function is asked for the object, and a member is laid on it, behind a loop and in front of the next.
function* asked(n) { for (let i = 0; i < n; i++) yield i; }
for (const x of asked(1)) console.log("before", x);
asked.prototype.next = function () { return { done: true, value: undefined }; };
let turns = 0;
for (const x of asked(3)) turns++;
console.log("turns with a next of the program's own", turns);

// The function goes through a box to code that asks.
function* boxed(n) { for (let i = 0; i < n; i++) yield i; }
const box = { f: boxed };
for (const x of boxed(1)) console.log("boxed", x);
console.log(typeof Reflect.get(box.f, "prototype"), Object.getOwnPropertyNames(box.f).includes("prototype"));

// The function names itself.
const named = function* self(n) { if (n) yield Object.getPrototypeOf(self.prototype) === Object.getPrototypeOf(asked.prototype); };
for (const x of named(1)) console.log("names itself", x);

// arguments.callee in sloppy code: this file is a module, so the function comes out of Function.
const sloppy = new Function("return function* (n) { yield typeof arguments.callee.prototype; }")();
for (const x of sloppy(1)) console.log("callee", x);

// A fresh closure for each call of the maker, as a nested generator function is.
function walk(depth) {
  function* visit(level) { yield level; if (level < depth) yield* visit(level + 1); }
  let sum = 0;
  for (const level of visit(0)) sum += level;
  return sum;
}
console.log(walk(3), walk(5), walk(0));

// A return and a throw that are sent in through a delegation.
function* inner() { try { yield 1; yield 2; } finally { console.log("inner is left"); } }
function* through() { yield* inner(); }
const sent = through();
console.log(JSON.stringify(sent.next()), JSON.stringify(sent.return("out")));
const thrown = through();
thrown.next();
try { thrown.throw(new Error("sent in")); } catch (error) { console.log(error.message); }
