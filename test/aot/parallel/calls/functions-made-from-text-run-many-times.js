// Functions made from text at run time that run hundreds of times, and then meet what they have not met before:
// other shapes, missing names, getters, thrown errors, collections, fewer and more arguments, changed prototypes.
const rounds = 400;
const lines = [];
const note = (...parts) => lines.push(parts.join(" "));

function repeat(f, ...rest) {
  let last;
  for (let i = 0; i < rounds; i++) last = f(...rest);
  return last;
}

// Reads by name: one shape for a long time, then others.
const readName = new Function("o", "return o.name;");
note("reads", repeat(readName, { name: "first" }));
note(readName({ other: 1, name: "second" }), readName({ get name() { return "getter"; } }), readName(Object.create({ name: "inherited" })), readName("text"), readName(7), readName([]));
try { readName(null); } catch (error) { note(error.constructor.name); }
try { readName(undefined); } catch (error) { note(error.constructor.name); }
note(repeat(readName, Object.create({ name: "inherited often" })), repeat(readName, {}), repeat(readName, function named() {}));
const manyProperties = {};
for (let i = 0; i < 100; i++) manyProperties["p" + i] = i;
manyProperties.name = "out of line";
note(repeat(readName, manyProperties));

class Pair { constructor(left, right) { this.left = left; this.right = right; } }
const grown = new Pair(1, { name: "inner" });
grown.name = "added later";
grown.more = 5;
const readRight = new Function("o", "return o.right;");
note(repeat(readName, grown), repeat(readName, new Pair(1, 2)), readName(repeat(readRight, grown)), repeat(readRight, new Pair(1, "text")), repeat(readRight, new Pair(1, undefined)), repeat(readRight, new Pair(1, 2.5)));
delete grown.name;
note(readName(grown), repeat(readName, grown));

// Chains of reads, lengths, conditions.
const countIssues = new Function("r", "if (r.issues.length) return r.issues.length + r.value.size; return r.value.size;");
note("chains", repeat(countIssues, { issues: [], value: { size: 3 } }), countIssues({ issues: [1, 2], value: { size: 3 } }), countIssues({ issues: "four", value: { size: 3 } }), countIssues({ issues: { length: 0 }, value: { size: 5 } }));

// `in`.
const hasKey = new Function("o", "return 'key' in o;");
note("in", repeat(hasKey, { key: 1 }), hasKey({}), hasKey({ other: 1, key: undefined }), hasKey(Object.create({ key: 1 })), hasKey([]), hasKey(new Proxy({}, { has: () => true })));
try { hasKey(1); } catch (error) { note(error.constructor.name); }
const losesKey = { key: 1 };
note(repeat(hasKey, losesKey));
delete losesKey.key;
note(hasKey(losesKey), repeat(hasKey, losesKey));
class Point { constructor(x) { this.x = x; if (x > 1) this.key = x; } }
note(repeat(hasKey, new Point(2)), hasKey(new Point(1)), repeat(hasKey, new Point(0)));

// Stores: new properties, replaced ones, setters, frozen objects.
const fill = new Function("a", "b", "const o = {}; o.a = a; o.b = b; o.a = b; return o;");
note("stores", JSON.stringify(repeat(fill, 1, "two")), JSON.stringify(fill({}, [])));
const setValue = new Function("o", "v", "o.value = v; return o;");
note(JSON.stringify(repeat(setValue, { value: 0 }, 5)), JSON.stringify(setValue({}, 6)), JSON.stringify(setValue({ set value(v) { this.seen = v; } }, 7)), JSON.stringify(setValue(Object.freeze({ value: 1 }), 8)));
const above = {};
const addB = new Function("above", "v", "const o = Object.create(above); o.b = v; return o;");
note(JSON.stringify(repeat(addB, above, 1)));
Object.defineProperty(above, "b", { set(v) { note("setter above", v); }, configurable: true });
note(JSON.stringify(addB(above, 2)));
delete above.b;
note(JSON.stringify(addB(above, 3)), JSON.stringify(repeat(addB, above, 4)));

// Literals.
const wrap = new Function("v", "return { value: v, issues: [] };");
const wrapped = repeat(wrap, 1);
wrapped.issues.push(1, "two", 3.5, {});
note("literals", JSON.stringify(wrapped), JSON.stringify(wrap("s")), JSON.stringify(wrap(undefined)), JSON.stringify(wrap(1.5)), wrap(1).issues === wrap(1).issues, Array.isArray(wrap(0).issues));
const sparse = wrap(0).issues;
sparse[10] = 1;
note(sparse.length, 5 in sparse, JSON.stringify(wrap(null)));

// Variables of enclosing functions, some read before they are initialized.
const makeCounter = new Function("start", "let count = start; return function () { count = count + 1; return count; };");
note("closures", repeat(makeCounter(10)), repeat(makeCounter(-rounds)));
const readsEarly = new Function("early", "const f = function () { return late; }; if (early) return f(); const late = 1; return f();");
note(repeat(readsEarly, false));
try { readsEarly(true); } catch (error) { note(error.constructor.name); }

// Calls: to the program, to text, to built-ins, to what cannot be called, with every number of arguments.
function addAll(a = 0, b = 0, c = 0) { return a + b + c + arguments.length; }
const callIt = new Function("f", "a", "b", "return f(a, b);");
note("calls", repeat(callIt, addAll, 1, 2), callIt(Math.max, 3, 4), callIt(readName, { name: "from text" }), callIt((...all) => all.length), callIt(addAll.bind(null, 5), 1, 2));
try { callIt(5); } catch (error) { note(error.constructor.name); }
try { callIt(class A {}); } catch (error) { note(error.constructor.name); }
const three = new Function("a", "b", "c", "return [a, b, c, arguments.length].join();");
note(repeat(three), repeat(three, 1), repeat(three, 1, 2, 3), repeat(three, 1, 2, 3, 4, 5));
const Made = new Function("x", "this.x = x; this.twice = x * 2;");
let made;
for (let i = 0; i < rounds; i++) made = new Made(i);
note(JSON.stringify(made), made instanceof Made, Made.call({ y: 1 }, 2));

// Errors thrown through and caught inside.
const guarded = new Function("f", "v", "let r = 0; for (let i = 0; i < 3; i++) { try { r += f(v, i); } catch (error) { r += error.cost; } finally { r += 1; } } return r;");
const sometimesThrows = (v, i) => { if (i === v) throw { cost: 100 }; return 10; };
note("errors", repeat(guarded, sometimesThrows, -1), guarded(sometimesThrows, 1), repeat(guarded, sometimesThrows, 2));
const rethrows = new Function("o", "return o.a.b.c;");
note(repeat(rethrows, { a: { b: { c: "deep" } } }));
try { rethrows({ a: {} }); } catch (error) { note(error.constructor.name, error.stack.split("\n").length > 1); }

// Loops.
const total = new Function("list", "let sum = 0; for (let i = 0; i < list.length; i++) { if (list[i]) sum += list[i]; } return sum;");
note("loops", repeat(total, [1, 2, 0, 3]), total([1.5, 2.5]), total(["a", "b"]), total({ length: 2, 0: 4, 1: 5 }), total(new Array(2000).fill(1)));
note(new Function("n", "let i = 0; while (true) { i++; if (i >= n) break; } return i;")(100000));

// Conditions on every kind of value.
const pick = new Function("v", "if (v) return 'yes'; return 'no';");
note("conditions", repeat(pick, true), [false, 0, 1, -0, NaN, 0.5, "", "x", null, undefined, {}, [], 0n, 1n, Symbol()].map(pick).join());

// Shapes that nothing holds any more, between collections.
for (let round = 0; round < 3; round++) {
  const key = "only" + round;
  let seen = 0;
  for (let i = 0; i < rounds; i++) {
    const o = { [key]: i, name: "n" + round, key: i };
    seen += readName(o).length + (hasKey(o) ? 1 : 0);
  }
  Bun.gc(true);
  note("collected", seen, readName({ name: "after" }), hasKey({ key: 0 }));
}

// A very long function.
let body = "let t = 0;";
for (let i = 0; i < 300; i++) body += `const v${i} = o.a + ${i}; if (v${i} > limit) t += v${i};`;
const long = new Function("o", "limit", body + "return t;");
note("long", repeat(long, { a: 1 }, 250), long({ a: 2 }, 0), long({ get a() { return 3; } }, 299));

console.log(lines.join("\n"));
