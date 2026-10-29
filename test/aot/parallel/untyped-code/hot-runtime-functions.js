// Functions made at run time are called hundreds of times each, so that whatever an engine does with a function that has become warm is done to them.
// Every call must answer as the first one did: each case is run on the same cycle of arguments from the first call to the last and the answers are compared turn by turn.
const lines = [];
const show = value => {
  if (typeof value === "function") return "function " + value.length;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (value instanceof TypeError) return value.name;
  if (value instanceof Error) return value.name + ": " + value.message;
  if (value instanceof Map) return "Map " + show([...value]);
  if (value instanceof Set) return "Set " + show([...value]);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (value && typeof value === "object") return "{" + Reflect.ownKeys(value).map(key => String(key) + ": " + show(value[key])).join(", ") + "}";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
};
const attempt = (callee, receiver, args) => {
  try {
    return show(Reflect.apply(callee, receiver, args));
  } catch (error) {
    return "thrown " + show(error);
  }
};
const turns = 420;
const run = (name, callee, cycle, receiver) => {
  const first = cycle.map(() => undefined);
  let differences = 0;
  for (let turn = 0; turn < turns; turn++) {
    const place = turn % cycle.length;
    const answer = attempt(callee, receiver, cycle[place]());
    if (turn < cycle.length) first[place] = answer;
    else if (answer !== first[place] && differences++ < 3) lines.push(name + ": turn " + turn + ": " + answer + " was " + first[place]);
  }
  lines.push(name + ": " + first.join(" | ") + (differences ? " DIFFERENCES: " + differences : ""));
};
const each = (...lists) => lists.map(list => () => list);

run("numbers", new Function("a", "b", "let r = a + b; r = r * 3 - a; r = r / 2; r = r % 7; r += a | b; r -= a & b; r ^= a << 2; r += b >> 1; r += b >>> 1; r = -r; r++; return [r, a < b, a <= b, a > b, a >= b, a == b, a === b, a != b, a !== b, ~a, +b, a ** 2];"),
  each([1, 2], [2147483647, 1], [-2147483648, -1], [1.5, 2.25], [0, -0], [NaN, 1], [Infinity, -Infinity], ["3", 4], [null, undefined], [true, false], [{ valueOf() { return 7; } }, [8]], [10n, 3]));
run("strings", new Function("a", "b", "const joined = a + b + '!' + a.length; let count = 0; for (let i = 0; i < joined.length; i++) if (joined[i] === 'a' || joined.charCodeAt(i) > 200) count++; return [joined, count, a < b, a === b, `${a}-${b}`, typeof a, joined.slice(1, 4), a ? 1 : 2, !b];"),
  each(["a", "b"], ["", ""], ["banana", "bandana"], ["éè", "世界"], ["x".repeat(40), "y"], ["same", "sa" + "me"]));
run("reads", new Function("o", "return [o.a, o.b, o.c, o.length, o.missing, o.a === undefined, 'a' in o, 'toString' in o, typeof o.toString, o.inherited, o.got];"),
  each([{ a: 1, b: 2 }], [{ b: 2, a: 1, c: 3 }], [[1, 2, 3]], ["text"], [Object.create({ inherited: "yes", a: "far" })], [{ get got() { return this.a + 1; }, a: 41 }], [function named(x, y) {}], [Object.create(null)], [7], [null], [undefined], [new Proxy({ a: 1 }, { get: (target, key) => (typeof key === "string" ? key + "!" : undefined), has: () => false })]));
run("stores", new Function("o", "v", "o.a = v; o.b = v + 1; o.fresh = v; o.a += 1; o['k' + v] = v; o[0] = v; delete o.b; return o;"),
  [() => [{}, 1], () => [{ a: 0, b: 0 }, 2], () => [{ set a(x) { this.seen = x; }, get a() { return 5; } }, 3], () => [[], 4], () => [Object.freeze({ a: 9 }), 5], () => [Object.create({ set fresh(x) { this.caught = x; } }), 6], () => [null, 7], () => ["text", 8]]);
run("strict stores", new Function("o", "v", "'use strict'; o.a = v; return o;"), [() => [Object.freeze({ a: 9 }), 5], () => [{ get a() { return 1; } }, 6], () => ["text", 7], () => [{}, 8]]);
run("literals", new Function("v", "return [{ value: v, issues: [] }, [v, [v], , v], { [v]: v, ...{ spread: v } }, /x+/g.flags, () => v, function (a, b) { return v; }, class { static made = v; }.made, `t${v}`, [...'ab', v]];"), each([1], ["s"], [null]));

const thrower = new Function("v", "if (v % 3 === 0) throw new RangeError('third ' + v); if (v % 3 === 1) return null.property; return v;");
run("catching", new Function("thrower", "v", "const seen = []; for (let i = v; i < v + 4; i++) { try { seen.push(thrower(i)); } catch (error) { seen.push(error.name); continue; } finally { seen.push('f' + i); } seen.push('after'); } let total = 0; for (const entry of seen) total += entry.length || entry; return [seen, total];"),
  each([thrower, 0], [thrower, 1], [thrower, 2]));
run("catching its own", new Function("v", "let where = 'start'; try { where = 'tried'; if (v > 1) throw { v }; where = 'passed'; } catch ({ v: caught }) { where = 'caught ' + caught; try { undefinedName; } catch (inner) { where += ' ' + inner.name; } } const after = { where }; after.more = after.where.length + v; return after;"), each([0], [2], [3]));
run("not catching", new Function("thrower", "v", "try { return thrower(v); } finally { if (v === 6) return 'overridden'; }"), each([thrower, 3], [thrower, 4], [thrower, 5], [thrower, 6]));
run("dead zones", new Function("v", "const read = () => later; if (v) return read(); const later = 1; return read();"), each([0], [1]));
run("constants", new Function("v", "const fixed = 1; if (v) fixed = 2; return fixed;"), each([0], [1]));

run("switch on integers", new Function("v", "switch (v) { case 0: return 'zero'; case 1: case 2: v += 10; case 3: return 'low ' + v; case 7: break; case 9: return 'nine'; default: return 'other'; } return 'seven';"), each([0], [1], [2], [3], [4], [7], [9], [-1], [1.5], ["1"], [NaN], [100000]));
run("switch on characters", new Function("v", "switch (v) { case 'a': return 1; case 'b': return 2; case 'e': return 5; case 'z': return 26; default: return 0; }"), each(["a"], ["b"], ["c"], ["z"], ["ab"], [""], [97], ["a" + ""]));
run("switch on strings", new Function("v", "switch (v) { case 'GET': return 1; case 'POST': return 2; case 'DELETE': return 3; case 'OPTIONS': return 4; default: return 0; }"), each(["GET"], ["PO" + "ST"], ["PUT"], ["DELETE"], [null], ["OPTIONS".slice(0)]));
run("switch in a loop", new Function("text", "let sum = 0; for (let i = 0; i < text.length; i++) { switch (text.charCodeAt(i) & 3) { case 0: sum += 1; break; case 1: sum += 10; break; case 2: sum += 100; continue; case 3: sum += 1000; } sum ^= i; } return sum;"), each(["abcdefgh"], ["the quick brown fox"], [""]));

run("iteration", new Function("list", "const out = []; for (const item of list) { if (item === 'stop') break; out.push(item); } const [first, second = 'none', ...rest] = list; return [out, first, second, rest];"),
  [() => [[1, 2, 3]], () => ["héllo"], () => [new Set([1, "stop", 2])], () => [new Map([[1, 2]])], () => [(function* () { yield 1; yield 2; })()], () => [[]], () => [5], () => [{ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 2, value: n++ }), return() { return {}; } }; } }]]);
run("keys", new Function("o", "const out = []; for (const key in o) out.push(key + '=' + o[key]); return out;"), each([{ a: 1, b: 2 }], [[7, 8]], ["ab"], [Object.create({ far: 1 }, { near: { value: 2, enumerable: true } })], [null]));
run("spreading", new Function("callee", "list", "return [callee(...list), callee(0, ...list, 9), callee.apply(null, list), new callee(...list) instanceof callee, Math.max(...list)];"), each([function (...all) { return all.length + ":" + all.join(); }, [1, 2, 3]], [function (a, b) { return a + b; }, []], [function () { return arguments.length; }, [5]]));
run("arguments", new Function("a", "b = a + 1", "...rest", "return [a, b, rest, arguments.length, arguments[1]];"), each([], [1], [1, undefined, 3], [1, 2, 3, 4]));
run("sloppy arguments", new Function("a", "arguments[0] = 'changed'; const before = a; a = 'again'; return [before, arguments[0], arguments.length];"), each([1], [], [1, 2]));
run("instances", new Function("v", "C", "return [v instanceof C, v instanceof Object, typeof v, v?.constructor === C, v?.missing?.deeper ?? 'absent'];"),
  each([[], Array], [{}, Array], [new Date(0), Date], [1, Number], [null, Object], [5, { [Symbol.hasInstance]: value => value === 5 }], [{}, () => {}], [{}, {}]));
run("this", new Function("return [typeof this, this === undefined, this === null, this?.tag];"), each([]), { tag: "receiver" });
run("this of a number", new Function("return [typeof this, this + 1];"), each([]), 41);
run("strict this", new Function("'use strict'; return [typeof this, this];"), each([]), 41);
run("direct eval", new Function("v", "var local = v * 2; const answer = eval('local + v'); eval('var made = answer + 1'); return [answer, made, typeof eval];"), each([1], [2]));
run("with", new Function("o", "v", "with (o) { return [v, typeof inside === 'undefined' ? 'none' : inside]; }"), each([{ v: "shadowed" }, 1], [{ inside: 2 }, 1], [{}, 1]));
run("globals", new Function("return [typeof globalThis, typeof undeclared, undefined, NaN, Infinity, typeof Math.floor, isNaN(NaN), parseInt('12px')];"), each([]));
run("sloppy globals", new Function("v", "madeByAssignment = v; const read = madeByAssignment; delete globalThis.madeByAssignment; return [read, typeof madeByAssignment];"), each([1], ["two"]));
run("construction", new Function("v", "class Base { constructor(x) { this.x = x; } get double() { return this.x * 2; } static of(x) { return new this(x); } } class Derived extends Base { #hidden = 3; constructor(x) { super(x + 1); this.y = this.#hidden + x; } sum() { return super.double + this.y; } } const made = Derived.of(v); return [made.sum(), made instanceof Base, Object.keys(made), new.target === undefined];"), each([1], [2.5]));
run("as a constructor", new Function("v", "this.v = v; if (v === 2) return { other: true }; if (v === 3) return 5;"), each([1]), {});
const Made = new Function("v", "this.v = v; this.target = new.target === undefined ? 'call' : 'new'; if (v === 2) return { other: true };");
run("new", new Function("Made", "v", "return new Made(v);"), each([Made, 1], [Made, 2], [Made, 3]));

const counterOf = new Function("start", "let count = start; return { up: () => ++count, down() { return --count; }, get now() { return count; }, reset(to = start) { count = to; } };");
const counter = counterOf(10);
let walked = 0;
for (let turn = 0; turn < turns; turn++) walked += turn % 3 ? counter.up() : counter.down();
counter.reset();
lines.push("closures: " + walked + " " + counter.now + " " + counterOf(1).up());
const adders = [];
for (let turn = 0; turn < turns; turn++) adders.push(new Function("n", "return x => x + n;")(turn));
lines.push("many closures: " + adders.reduce((sum, add, place) => sum + add(place), 0));

const fibonacci = new Function("self", "n", "return n < 2 ? n : self(self, n - 1) + self(self, n - 2);");
lines.push("recursion: " + fibonacci(fibonacci, 18));
const depth = new Function("self", "n", "try { return self(self, n + 1); } catch (error) { return error instanceof RangeError ? 'overflowed' : 'other'; }");
lines.push("too deep: " + depth(depth, 0) + " " + depth(depth, 0));
const tail = new Function("self", "n", "sum", "'use strict'; if (!n) return sum; return self(self, n - 1, sum + n);");
lines.push("tail calls: " + tail(tail, 200000, 0));
const longLoop = new Function("n", "let sum = 0; const seen = { odd: 0, even: 0 }; for (let i = 0; i < n; i++) { if (i & 1) seen.odd += i; else seen.even += i; sum = (sum + i * 3) % 1000003; } return [sum, seen.odd, seen.even];");
lines.push("one long loop: " + longLoop(300000));
const nestedLoops = new Function("n", "let hits = 0; outer: for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { if (j > i) continue outer; if (i * j > 5000) break outer; hits++; } } return hits;");
lines.push("labels: " + nestedLoops(200));
const throwsLate = new Function("n", "let i = 0; try { for (; ; i++) if (i === n) throw new Error('at ' + i); } catch (error) { let more = 0; for (let j = 0; j < 1000; j++) more += j; return error.message + ' ' + more; }");
lines.push("a throw out of a long loop: " + throwsLate(5000) + " " + throwsLate(10));

const generator = new Function("return function* (n) { let sent = 0; for (let i = 0; i < n; i++) sent += (yield i + sent) ?? 0; try { yield 'last'; } finally { sent += 100; } return sent; };")();
let generated = "";
for (let turn = 0; turn < turns; turn++) {
  const walker = generator(3);
  const parts = [walker.next(), walker.next(1), walker.next(2), walker.next(3), turn % 2 ? walker.return("early") : walker.next(), walker.next()].map(step => step.value + "/" + step.done).join(" ");
  if (!turn) generated = parts;
  else if (turn === 1) generated += " | " + parts;
  else if (!generated.includes(parts)) generated += " DIFFERENT " + parts;
}
lines.push("generators: " + generated);
const suspended = [];
for (let turn = 0; turn < turns; turn++) {
  const walker = generator(2);
  walker.next();
  suspended.push(walker);
}
lines.push("generators resumed later: " + suspended.reduce((sum, walker) => sum + walker.next(5).value, 0));

const places = new Function("deep", "const inner = () => { if (deep) throw new Error('x'); return new Error('y'); };\ntry {\n  return inner();\n} catch (error) {\n  return error;\n}");
const place = error => error.line + ":" + error.column;
const firstPlaces = place(places(0)) + " " + place(places(1));
let samePlaces = true;
for (let turn = 0; turn < turns; turn++) samePlaces &&= place(places(0)) + " " + place(places(1)) === firstPlaces;
lines.push("the places of errors stay: " + samePlaces);
const named = new Function("callee", "return callee();");
const frames = () => new Error("here").stack.split("\n").filter(line => /anonymous/.test(line)).length;
const firstFrames = named(frames);
let sameFrames = true;
for (let turn = 0; turn < turns; turn++) sameFrames &&= named(frames) === firstFrames;
lines.push("the frames of a stack stay: " + sameFrames);

const waits = new Function("return async function (v) { const first = await v; let sum = first; for (const next of [1, Promise.resolve(2)]) sum += await next; try { await Promise.reject(new Error('no')); } catch (error) { sum += error.message.length; } return sum; };")();
const pending = [];
for (let turn = 0; turn < turns; turn++) pending.push(waits(turn));
const streams = new Function("return async function* (n) { for (let i = 0; i < n; i++) yield await i; };")();
const drain = new Function("streams", "return (async n => { let sum = 0; for await (const item of streams(n)) sum += item; return sum; });")(streams);
for (let turn = 0; turn < turns; turn++) pending.push(drain(turn % 5));
Promise.all(pending).then(all => {
  lines.push("async: " + all.reduce((sum, item) => sum + item, 0));
  console.log(lines.join("\n"));
});
