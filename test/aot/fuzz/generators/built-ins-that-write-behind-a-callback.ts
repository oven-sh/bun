// A built-in calls back into the program: a reviver, a comparator, a species constructor, a getter, a trap, valueOf of an argument. Behind the callback it stores, defines or deletes,
// in an object that the callback has handed in, swapped, grown, shrunk or detached. Loops and reads by name look at an instance, a literal, four arrays and a typed array before and after.
const head = `function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
class A { ga = { qb: 1 }; gb = { qb: 2 }; gc = 1.5; }
const inst = new A();
const lit = { la: { qb: 3 }, lb: 4 };
const ints = [1, 2, 3, 4], doubles = [1.5, 2.5, 3.5], objects = [{ qb: 5 }, { qb: 6 }], strings = ["a", "bc"];
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function fields(a) { let t = ""; for (let i = 0; i < a.length; i++) t += attempt(() => a[i].qb) + ","; return t; }
function lengths(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i].length; return t; }
function state() {
  return [attempt(() => inst.ga.qb), attempt(() => inst.gb.qb), attempt(() => inst.gc + 1), Object.keys(inst).join("+"), attempt(() => lit.la.qb), attempt(() => lit.lb + 1), Object.keys(lit).join("+"),
    attempt(() => sum(ints)), ints.length, attempt(() => sum(doubles)), doubles.length, fields(objects), attempt(() => lengths(strings)), attempt(() => sum(bytes)), bytes.length].join(" | ");
}
console.log(state());
`;
const tail = `
console.log(state());
console.log(new A().ga.qb, sum([1, 2, 3]), sum([0.5, 1.5]), fields([{ qb: 7 }]), lengths(["xyz"]), sum(new Uint8Array([9, 9])));
`;

const show = (expression: string) => `console.log(attempt(() => ${expression}));`;
/** What a species constructor, or `this` of Array.from and Array.of, answers in the place of a new object. */
const answering = (victim: string) => `function () { return ${victim}; }`;
const withSpecies = (source: string, victim: string, call: string) => `const source = ${source}; source.constructor = { [Symbol.species]: ${answering(victim)} }; ${show(`String(source.${call})`)}`;
/** An argument whose conversion to a number runs the statement. */
const converting = (statement: string, answer = 0) => `{ valueOf() { ${statement} return ${answer}; } }`;
const named = (key: string) => `{ toString() { return ${JSON.stringify(key)}; } }`;
const detach = `if (bytes.buffer.byteLength) structuredClone(bytes.buffer, { transfer: [bytes.buffer] });`;

export const cases: Record<string, string> = {
  // The walk of JSON.parse.
  "JSON.parse deletes in an instance that the reviver put into the holder": `JSON.parse('{"a":1,"b":2}', function (k, v) { if (k === "a") this.b = inst; return k === "ga" ? undefined : v; });`,
  "JSON.parse defines in an instance that the reviver put into the holder": `JSON.parse('{"a":1,"b":2}', function (k, v) { if (k === "a") this.b = inst; return k === "gb" ? 7 : k === "gc" ? "text" : v; });`,
  "JSON.parse deletes and defines in arrays that the reviver put into the holder": `JSON.parse('{"a":1,"b":2,"c":3,"d":4}', function (k, v) { if (k === "a") { this.b = ints; this.c = objects; this.d = doubles; } return this === ints ? (k === "1" ? undefined : k === "2" ? "s" : v) : this === objects ? (k === "0" ? 5 : v) : this === doubles ? (k === "1" ? undefined : v) : v; });`,
  "JSON.parse deletes in a literal that the reviver put into an array": `JSON.parse('[1,2]', function (k, v) { if (k === "0") this[1] = lit; return k === "la" ? undefined : v; });`,
  "JSON.parse goes into an instance that the reviver put below a value it has not reached": `JSON.parse('{"a":1,"b":{"c":2}}', function (k, v) { if (k === "a") this.b.c = inst; return k === "gb" ? null : v; });`,

  // What the reviver answers is defined in the holder and never walked.
  "a reviver answers a new literal": `const parsed = JSON.parse('{"a":{"v":1},"b":[{"v":2},{"v":3}]}', (k, v) => v && v.v ? { fresh: v.v, more: { qb: v.v * 2 } } : v); ${show("parsed.a.more.qb + parsed.b[0].more.qb + parsed.b[1].fresh + Object.keys(parsed.a).join()")}`,
  "a reviver answers a new instance": `const parsed = JSON.parse('{"a":{"v":1},"b":[{"v":2},{"v":3}]}', (k, v) => v && v.v ? new A() : v); ${show("parsed.a.ga.qb + parsed.b[0].gb.qb + parsed.b[1].gc + Object.keys(parsed.a).join() + (parsed.a instanceof A)")}`,
  "a reviver answers objects that the program has had for long": `const parsed = JSON.parse('{"a":1,"b":2,"c":[3,4]}', (k, v) => k === "a" ? inst : k === "b" ? lit : k === "0" ? inst : k === "1" ? lit : v); ${show("(parsed.a === inst) + ',' + (parsed.b === lit) + ',' + (parsed.c[0] === inst) + parsed.a.ga.qb + parsed.c[1].la.qb")}`,
  "a reviver answers arrays that the program has had for long": `const parsed = JSON.parse('{"a":1,"b":2,"c":3,"d":{"e":4}}', (k, v) => k === "a" ? ints : k === "b" ? doubles : k === "c" ? objects : k === "e" ? strings : v); ${show("sum(parsed.a) + sum(parsed.b) + fields(parsed.c) + lengths(parsed.d.e) + (parsed.a === ints)")}`,
  "a reviver answers the typed array of the program": `const parsed = JSON.parse('[1,{"a":2}]', (k, v) => k === "0" || k === "a" ? bytes : v); ${show("sum(parsed[0]) + sum(parsed[1].a)")}`,
  "a reviver answers a Map made of what it is given": `const parsed = JSON.parse('{"m":{"$map":[["k1",1],["k2",{"$map":[["in",2]]}]]},"n":5}', (k, v) => v && v.$map ? new Map(v.$map) : v); ${show("parsed.m.size + parsed.m.get('k1') + parsed.m.get('k2').get('in') + parsed.n + (parsed.m instanceof Map)")}`,
  "a reviver answers a Set and a Date made of what it is given": `const parsed = JSON.parse('{"s":{"$set":[1,2,2]},"d":{"$date":86400000}}', (k, v) => v && v.$set ? new Set(v.$set) : v && v.$date ? new Date(v.$date) : v); ${show("parsed.s.size + parsed.d.getTime() + parsed.d.toISOString()")}`,
  "a reviver answers what a helper has copied under other keys": `function mapKeys(object, f) { const result = {}; for (const key of Object.keys(object)) result[f(object[key], key)] = object[key]; return result; } const camel = (value, key) => key.replace(/_([a-z])/g, (m, c) => c.toUpperCase()); const parsed = JSON.parse('{"first_name":"a","the_address":{"street_name":"b","house_number":7},"all_items":[{"item_id":1},{"item_id":2}]}', (k, v) => v && typeof v === "object" && !Array.isArray(v) ? mapKeys(v, camel) : v); ${show("parsed.firstName + parsed.theAddress.streetName + parsed.theAddress.houseNumber + parsed.allItems[1].itemId + Object.keys(parsed).join()")}`,
  "a reviver answers a copy of an object of the program with more keys": `const parsed = JSON.parse('{"a":{"x":1},"b":{"x":2}}', (k, v) => v && v.x ? { ...lit, ...v } : v); ${show("parsed.a.la.qb + parsed.a.lb + parsed.b.x + (parsed.a.la === lit.la)")}`,
  "a reviver answers undefined for some keys of what was parsed": `const parsed = JSON.parse('{"a":1,"b":{"c":2,"d":3},"e":[4,5,6]}', (k, v) => k === "c" || k === "1" || k === "a" ? undefined : v); ${show("JSON.stringify(parsed) + (1 in parsed.e) + parsed.e.length")}`,

  // A species constructor, or the receiver of Array.from and Array.of, answers an object that exists.
  "map stores into an array of numbers that the species constructor answers": withSpecies(`["s", "t"]`, "ints", "map(v => v)"),
  "map stores into an array of objects that the species constructor answers": withSpecies(`[1, 2]`, "objects", "map(v => v)"),
  "map stores into an array of doubles that the species constructor answers": withSpecies(`[{}, "t"]`, "doubles", "map(v => v)"),
  "filter stores into an array of numbers that the species constructor answers": withSpecies(`["s", "t"]`, "ints", "filter(() => true)"),
  "slice stores into an array of numbers that the species constructor answers": withSpecies(`["s", "t"]`, "ints", "slice(0)"),
  "splice stores into an array of strings that the species constructor answers": withSpecies(`[1, 2, 3]`, "strings", "splice(0, 2)"),
  "concat stores into an array of numbers that the species constructor answers": withSpecies(`["s"]`, "ints", `concat(["t"], "u")`),
  "flat stores into an array of numbers that the species constructor answers": withSpecies(`[["s"], "t"]`, "ints", "flat()"),
  "flatMap stores into an array of objects that the species constructor answers": withSpecies(`[1, 2]`, "objects", "flatMap(v => [v])"),
  "map defines in an instance that the species constructor answers": withSpecies(`["s", "t"]`, "inst", "map(v => v)"),
  "slice stores a length into a literal that the species constructor answers": withSpecies(`["s", "t"]`, "lit", "slice(0)"),
  "Array.from stores into an array of numbers that its receiver answers": show(`String(Array.from.call(${answering("ints")}, ["s", "t"]))`),
  "Array.from stores what the mapping function answers into an array of objects": show(`String(Array.from.call(${answering("objects")}, [1, 2], v => v * 2))`),
  "Array.from over an array-like stores into an array of doubles": show(`String(Array.from.call(${answering("doubles")}, { length: 2, 0: "s", 1: null }))`),
  "Array.of stores into an array of strings that its receiver answers": show(`String(Array.of.call(${answering("strings")}, 1, 2, 3))`),
  "Array.of shortens an array of numbers that its receiver answers": show(`String(Array.of.call(${answering("ints")}, 9))`),
  "Array.fromAsync stores into an array of numbers that its receiver answers": `console.log(await Array.fromAsync.call(${answering("ints")}, ["s", "t"]).then(String, e => "rejected " + e.constructor.name));`,
  "a typed array's map stores into the typed array that the species constructor answers": `const source = new Uint8Array([200, 201]); source.constructor = { [Symbol.species]: ${answering("bytes")} }; ${show("String(source.map(v => v + 1))")}`,
  "a typed array's slice copies into the typed array that the species constructor answers": `const source = new Uint8Array([200, 201]); source.constructor = { [Symbol.species]: ${answering("bytes")} }; ${show("String(source.slice(0))")}`,
  "a typed array's filter meets a species constructor that detaches": `bytes.constructor = { [Symbol.species]: function (n) { ${detach} return new Uint8Array(n); } }; ${show("String(bytes.filter(() => true))")}`,
  "a buffer's slice copies into the buffer that the species constructor answers": `const source = new Uint8Array([200, 201, 202]).buffer; source.constructor = { [Symbol.species]: ${answering("bytes.buffer")} }; ${show("source.slice(0).byteLength")}`,
  "split stores lastIndex into an instance that the species constructor answers": `inst.exec = () => null; const pattern = /,/; pattern.constructor = { [Symbol.species]: ${answering("Object.assign(inst, { lastIndex: inst.ga })")} }; ${show(`"a,b".split(pattern).length + typeof inst.lastIndex`)}`,

  // Values that come out of getters, proxies and iterators go into an operand.
  "Object.assign stores what a getter answers into an instance": show(`Object.keys(Object.assign(inst, { get ga() { return 5; }, get gc() { return "text"; } })).length`),
  "Object.assign stores what a getter answers into an array of numbers": show(`String(Object.assign(ints, { get 1() { return "s"; } }))`),
  "Object.assign stores the characters of a string into an array of numbers": show(`String(Object.assign(ints, "st"))`),
  "Object.assign stores the elements of an array into an array of objects": show(`String(Object.assign(objects, [1]))`),
  "Object.assign stores what the traps of a proxy answer into an instance": show(`Object.keys(Object.assign(inst, new Proxy({}, { ownKeys: () => ["gb"], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }), get: () => 5 }))).length`),
  "Object.assign meets a getter that deletes what comes next": show(`Object.keys(Object.assign(lit, { get la() { delete lit.lb; return 1; }, lb: "s" })).join()`),
  "Object.defineProperties takes a value out of a getter": show(`Object.keys(Object.defineProperties(inst, { ga: { get value() { return 5; } }, gc: { get value() { return null; } } })).length`),
  "Object.defineProperties takes descriptors out of a proxy": show(`Object.keys(Object.defineProperties(inst, new Proxy({ gb: 0 }, { get: () => ({ value: "s" }) }))).length`),
  "Object.defineProperty takes its key out of toString": show(`Object.keys(Object.defineProperty(inst, ${named("ga")}, { value: 5 })).length`),
  "Object.defineProperty on an element of an array of numbers": show(`String(Object.defineProperty(ints, ${named("1")}, { value: "s" }))`),
  "Object.defineProperty makes an element an accessor": show(`String(Object.defineProperty(doubles, 1, { get() { return "g"; } }))`),
  "Object.defineProperty shortens an array by a length out of valueOf": show(`String(Object.defineProperty(ints, "length", { value: ${converting("", 1)} }))`),
  "Reflect.set takes its key out of toString": show(`Reflect.set(inst, ${named("gb")}, 5)`),
  "Reflect.set stores into a receiver that is another object": show(`Reflect.set({}, "ga", 5, inst) + "," + Reflect.set([], "0", "s", ints)`),
  "Reflect.set through a setter that deletes": show(`Reflect.set({ set ga(v) { delete this.ga; } }, "ga", 5, inst)`),
  "Reflect.deleteProperty takes its key out of toString": show(`Reflect.deleteProperty(inst, ${named("ga")}) + "," + Reflect.deleteProperty(ints, ${named("1")})`),
  "Reflect.defineProperty takes its attributes out of getters": show(`Reflect.defineProperty(lit, "la", { get value() { return 1; }, get writable() { delete lit.lb; return true; } })`),
  "a store under a key out of toString": `inst[${named("ga")}] = 5; ints[${named("2")}] = "s";`,
  "a deletion under a key out of toString": `delete inst[${named("gb")}]; delete doubles[${named("0")}];`,

  // An argument's conversion shrinks, grows or changes the receiver, and the built-in goes on with what it read before.
  "fill goes on behind a start that empties the array": show(`String(ints.fill(7, ${converting("ints.length = 0;")}))`),
  "fill goes on behind an end that stores a string": show(`String(ints.fill(7, 0, ${converting(`ints[3] = "s";`, 2)}))`),
  "fill with a string": show(`String(ints.fill("s", 1, 2)) + String(doubles.fill(null, 0, 1)) + String(objects.fill(1, 0, 1))`),
  "copyWithin goes on behind a target that empties the array": show(`String(ints.copyWithin(${converting("ints.length = 1;")}, 1))`),
  "copyWithin over holes that its argument makes": show(`String(doubles.copyWithin(0, ${converting("delete doubles[2];", 1)}))`),
  "splice goes on behind a start that empties the array": show(`String(ints.splice(${converting("ints.length = 0;", 1)}, 1, 8, 9))`),
  "splice inserts other kinds": show(`String(ints.splice(1, 1, "s")) + String(objects.splice(0, 1, 1)) + String(doubles.splice(0, 0, {}))`),
  "slice goes on behind a start that empties the array": show(`String(ints.slice(${converting("ints.length = 0;")}))`),
  "indexOf goes on behind a start that empties the array": show(`ints.indexOf(4, ${converting("ints.length = 0;")}) + "," + doubles.lastIndexOf(1.5, ${converting("doubles.length = 0;", 2)}) + "," + objects.includes(undefined, ${converting("objects.length = 0;")})`),
  "with goes on behind an index that empties the array": show(`String(ints.with(${converting("ints.length = 0;", 1)}, 9))`),
  "at behind an index that empties the array": show(`String(ints.at(${converting("ints.length = 0;", 1)}))`),
  "join behind a separator that empties the array": show(`ints.join({ toString() { ints.length = 0; return "-"; } })`),
  "join over elements whose toString changes the array": `objects[0].toString = () => { objects.length = 1; ints.length = 2; return "o"; }; ${show("objects.join()")}`,
  "push behind a length that a setter cannot be on": show(`ints.push("s") + "," + doubles.unshift(null) + "," + objects.push(1)`),
  "sort writes back behind a comparator that empties the array": show(`String(ints.sort((a, b) => { ints.length = 0; return b - a; }))`),
  "sort writes back behind a comparator that stores strings": show(`String(ints.sort((a, b) => { ints[0] = "s"; return b - a; }))`),
  "sort writes back behind a comparator that freezes the array": show(`String(doubles.sort((a, b) => { Object.freeze(doubles); return b - a; }))`),
  "sort writes back behind a comparator whose answer is converted": show(`String(ints.sort((a, b) => (${converting("ints.push(0.5);", 1)})))`),
  "sort of objects by toString that changes them": `objects[0].toString = () => { objects[1] = 1; return "z"; }; ${show("objects.sort().length")}`,
  "reverse over holes": `delete doubles[0]; ${show("String(doubles.reverse())")}`,
  "concat behind a getter of Symbol.isConcatSpreadable that empties the array": show(`String([0].concat(Object.defineProperty(ints, Symbol.isConcatSpreadable, { get() { ints.length = 1; return true; } })))`),
  "flat over an array that a getter in front of it empties": show(`String([Object.defineProperty([0], 0, { get() { ints.length = 1; return 0; } }), ints].flat())`),
  "a length stored out of valueOf": `ints.length = ${converting(`ints[3] = "s";`, 4)};`,

  // The same with typed arrays and buffers.
  "a typed array's fill behind a value that detaches": show(`String(bytes.fill(${converting(detach, 7)}))`),
  "a typed array's fill behind a start that detaches": show(`String(bytes.fill(7, ${converting(detach)}))`),
  "a typed array's set behind an offset that detaches": show(`String(bytes.set([1, 2], ${converting(detach)}))`),
  "a typed array's set over elements whose conversion detaches": show(`String(bytes.set([9, ${converting(detach, 8)}, 7]))`),
  "a typed array's set over an array-like whose length detaches": show(`String(bytes.set({ get length() { ${detach} return 2; }, 0: 1, 1: 2 }))`),
  "a typed array's copyWithin behind a target that detaches": show(`String(bytes.copyWithin(${converting(detach)}, 1))`),
  "a typed array's sort behind a comparator that detaches": show(`String(bytes.sort((a, b) => { ${detach} return b - a; }))`),
  "a typed array's with behind a value that detaches": show(`String(bytes.with(0, ${converting(detach, 7)}))`),
  "a typed array's subarray behind a start that detaches": show(`bytes.subarray(${converting(detach, 1)}).length`),
  "a typed array's slice behind a start that detaches": show(`String(bytes.slice(${converting(detach, 1)}))`),
  "a typed array's indexOf behind a start that detaches": show(`bytes.indexOf(3, ${converting(detach)}) + "," + bytes.includes(undefined, 0)`),
  "a typed array's join behind a separator that detaches": show(`bytes.join({ toString() { ${detach} return "-"; } })`),
  "a typed array's map behind a callback that detaches": show(`String(bytes.map(v => { ${detach} return v; }))`),
  "a typed array's forEach behind a callback that detaches": `let seen = ""; ${show(`(bytes.forEach(v => { seen += v + ","; if (v === 2) { ${detach} } }), seen)`)}`,
  "a typed array's reduce behind a callback that detaches": show(`bytes.reduce((t, v) => { ${detach} return t + "," + v; }, "")`),
  "an element stored out of a conversion that detaches": `bytes[1] = ${converting(detach, 7)};`,
  "a view's store behind an offset that detaches": show(`String(new DataView(bytes.buffer).setUint8(${converting(detach, 1)}, 7))`),
  "a view's store behind a value that detaches": show(`String(new DataView(bytes.buffer).setUint8(1, ${converting(detach, 7)}))`),
  "Atomics.store behind a value that detaches": show(`String(Atomics.store(bytes, 1, ${converting(detach, 7)}))`),
  "Atomics.add behind an index that detaches": show(`String(Atomics.add(bytes, ${converting(detach, 1)}, 7))`),
  "a typed array made over a buffer behind an offset that detaches": show(`new Uint8Array(bytes.buffer, ${converting(detach, 1)}).length`),
  "a typed array made from an iterator that detaches another": show(`String(new Uint8Array({ *[Symbol.iterator]() { ${detach} yield 1; } }))`),
  "TypedArray.from behind a mapping function that detaches its own result": show(`String(Uint8Array.from.call(${answering("bytes")}, [1, 2], v => { ${detach} return v; }))`),
  "a buffer that can be resized shrinks under fill": `const room = new ArrayBuffer(8, { maxByteLength: 16 }), view = new Uint8Array(room); ${show(`String(view.fill(7, ${converting("room.resize(2);")}))`)} ${show("sum(view) + ',' + view.length")}`,
  "a buffer that can be resized shrinks under set": `const room = new ArrayBuffer(8, { maxByteLength: 16 }), view = new Uint8Array(room); ${show(`String(view.set([1, ${converting("room.resize(1);", 2)}, 3]))`)} ${show("sum(view) + ',' + view.length")}`,
  "a buffer that can be resized shrinks under sort": `const room = new ArrayBuffer(8, { maxByteLength: 16 }), view = new Uint8Array(room); view.set([3, 1, 2]); ${show(`String(view.sort((a, b) => { room.resize(2); return a - b; }))`)} ${show("sum(view) + ',' + view.length")}`,
  "a reader of bytes takes the buffer away": `const reader = new ReadableStream({ type: "bytes", pull(c) { c.byobRequest.view[0] = 9; c.byobRequest.respond(1); } }).getReader({ mode: "byob" }); console.log(await reader.read(bytes).then(r => String(r.value), e => "rejected " + e.constructor.name));`,

  // Patterns.
  "replace stores lastIndex behind a function that changes the pattern": `const pattern = /a/g; ${show(`"aaa".replace(pattern, () => { pattern.lastIndex = 5; pattern.compile("b", "g"); return "-"; }) + pattern.lastIndex + pattern.source`)}`,
  "replace asks an exec that the program has put on the pattern": `const pattern = /a/g; let turns = 0; pattern.exec = function (s) { return turns++ ? null : Object.assign(ints, { index: 0 }); }; ${show(`"aaa".replace(pattern, "-") + pattern.lastIndex`)}`,
  "match stores lastIndex behind an exec that answers an empty match": `const pattern = /a/g; let turns = 0; pattern.exec = function (s) { return turns++ > 1 ? null : [""]; }; ${show(`String("aaa".match(pattern)) + pattern.lastIndex`)}`,
  "a lastIndex that cannot be written": `const pattern = Object.defineProperty(/a/g, "lastIndex", { writable: false }); ${show(`"aaa".replace(pattern, "-")`)} ${show(`pattern.test("a")`)}`,
  "a lastIndex out of valueOf that compiles the pattern anew": `const pattern = /a/y; pattern.lastIndex = ${converting(`pattern.compile("b", "y");`)}; ${show(`pattern.test("b") + "," + pattern.test("a") + pattern.lastIndex`)}`,
  "split behind a limit that changes the pattern": `const pattern = /,/; ${show(`String("a,b;c".split(pattern, ${converting(`pattern.compile(";");`, 9)}))`)}`,
  "replaceAll behind a replacement whose toString changes the pattern": `const pattern = /a/g; ${show(`"aba".replaceAll(pattern, { toString() { pattern.compile("b", "g"); return "-"; } })`)}`,

  // Collections, promises, errors.
  "a Map's constructor calls a set that the class has replaced": `class M extends Map { tag = { qb: 8 }; set(k, v) { console.log(attempt(() => this.tag.qb)); return super.set(k, v); } } ${show("new M([[1, 2]]).size")}`,
  "a Map's constructor takes entries that an iterator changes": show(`String([...new Map({ *[Symbol.iterator]() { yield ints; ints[0] = "s"; yield objects; objects.length = 0; } })])`),
  "Object.fromEntries takes entries that an iterator changes": show(`JSON.stringify(Object.fromEntries({ *[Symbol.iterator]() { yield strings; strings[1] = 5; yield strings; } }))`),
  "Object.groupBy behind a callback that changes the list": show(`JSON.stringify(Object.groupBy(ints, v => { ints.length = 2; ints[1] = "s"; return "k"; }))`),
  "Map.groupBy behind a callback that changes the list": show(`Map.groupBy(doubles, v => { doubles[2] = null; return v; }).size`),
  "Promise.all over a thenable that changes a list": `console.log(await Promise.all([{ then(r) { ints[0] = "s"; r(ints); } }, { then(r) { doubles.length = 0; r(1); } }]).then(v => v.length));`,
  "a promise's capability out of a class of the program": `class Cap { got = { qb: 9 }; constructor(ex) { ex(v => { this.got = v; }, () => {}); } } const cap = Promise.resolve.call(Cap, 5); ${show("cap.got.qb + typeof cap.got")}`,
  "an error takes its cause out of a getter that changes a list": show(`new Error("m", { get cause() { ints[1] = "s"; return inst; } }).cause === inst`),
  "Error.captureStackTrace defines a stack on an instance": show(`(Error.captureStackTrace(inst), typeof inst.stack)`),
  "structuredClone over a getter that changes what comes next": show(`JSON.stringify(structuredClone({ get a() { lit.lb = "s"; delete lit.la; return 1; }, b: lit }))`),
  "JSON.stringify with a replacer that changes the holder": show(`JSON.stringify({ a: 1, b: inst }, function (k, v) { if (k === "a") { delete inst.ga; inst.gc = "s"; } return v; })`),
  "JSON.stringify with a toJSON that changes what comes next": show(`JSON.stringify([{ toJSON() { ints[2] = "s"; ints.length = 3; return 0; } }, ints])`),
  "Function.prototype.apply over an array-like whose getter changes a list": show(`Math.max.apply(null, { length: 2, get 0() { ints[0] = "s"; return 1; }, 1: 2 })`),
  "a spread of a list whose iterator is the program's": `ints[Symbol.iterator] = function* () { ints[1] = "s"; yield 1; }; ${show("Math.max(...ints)")}`,

  // Traps under the built-ins that write.
  "Array.prototype.push through a proxy whose trap stores elsewhere": show(`Array.prototype.push.call(new Proxy(ints, { set(t, k, v) { t[k] = String(v); return true; } }), 5)`),
  "Array.prototype.reverse through a proxy without traps": show(`String(Array.prototype.reverse.call(new Proxy(doubles, {})))`),
  "Array.prototype.sort through a proxy whose trap deletes": show(`String(Array.prototype.sort.call(new Proxy(ints, { get(t, k) { if (k === "2") delete t[1]; return t[k]; } })))`),
  "Array.prototype.fill through a proxy without traps": show(`String(Array.prototype.fill.call(new Proxy(ints, {}), "s", 0, 1))`),
  "Array.prototype.splice through a proxy without traps": show(`String(Array.prototype.splice.call(new Proxy(objects, {}), 0, 1, 1))`),
  "Array.prototype.copyWithin through a proxy whose has trap lies": show(`String(Array.prototype.copyWithin.call(new Proxy(doubles, { has: (t, k) => k !== "1" }), 0, 1))`),
  "Object.assign to a proxy without traps": show(`Object.keys(Object.assign(new Proxy(inst, {}), { ga: 5 })).length`),
  "Object.freeze through a proxy without traps": `Object.freeze(new Proxy(inst, {})); Object.freeze(new Proxy(ints, {})); ${show(`(() => { "use strict"; inst.gc = 2; })()`)} ${show(`(() => { "use strict"; ints[0] = 2; })()`)} ${show("ints.push(1)")}`,
  "Object.setPrototypeOf through a proxy without traps": `Object.setPrototypeOf(new Proxy(ints, {}), { get length() { return "no"; }, extra: 1 }); ${show("ints.extra + String(ints.map)")}`,
  "a length stored through a proxy without traps": `new Proxy(ints, {}).length = 1; new Proxy(doubles, {}).length = 5;`,
  "a deletion through a proxy without traps": `delete new Proxy(ints, {})[1]; delete new Proxy(inst, {}).ga; delete new Proxy(lit, {}).la;`,

  // More of the same kinds.
  "a step of matchAll stores lastIndex into an instance behind an exec that answers an empty match": `let turns = 0; class Matcher { lastIndex = { qb: 1, valueOf() { return 0; } }; exec() { return turns++ ? null : [""]; } } const made = new Matcher(), pattern = /,/g; pattern.constructor = { [Symbol.species]: ${answering("made")} }; ${show(`[..."a,b".matchAll(pattern)].length + typeof made.lastIndex + attempt(() => made.lastIndex.qb)`)} ${show("new Matcher().lastIndex.qb")}`,
  "getOrInsertComputed behind a callback that fills the Map": `const m = new Map([[1, ints]]); ${show(`String(m.getOrInsertComputed(2, () => { m.clear(); m.set(2, "early"); return objects; })) + m.size`)}`,
  "a Date's setter behind an argument that sets the same Date": `const d = new Date(0); ${show(`d.setUTCHours(${converting("d.setTime(86400000 * 3);", 5)}) + "," + d.getTime()`)} ${show(`d.setUTCFullYear(${converting("d.setTime(NaN);", 2001)}) + "," + d.getTime()`)} ${show(`d.setTime(${converting("d.setTime(7);", 9)}) + "," + d.getTime()`)}`,
  "Object.values over a getter that deletes what comes next": show(`String(Object.values({ get a() { delete this.b; this.c = "late"; return 1; }, b: 2 }))`),
  "Object.entries over a getter that changes an instance it is asked about": `Object.defineProperty(inst, "early", { get() { delete inst.gb; inst.gc = "s"; return 0; }, enumerable: true, configurable: true }); delete inst.ga; inst.ga = { qb: 1 }; ${show("JSON.stringify(Object.entries(inst))")}`,
  "a spread over a getter that deletes what comes next": show(`JSON.stringify({ ...{ get a() { delete this.b; return 1; }, b: lit } })`),
  "JSON.stringify over a getter that changes what comes next": show(`JSON.stringify({ get a() { lit.lb = "s"; delete lit.la; ints[1] = null; return 1; }, b: lit, c: ints })`),
  "for-in over an instance whose fields are deleted on the way": `let keys = ""; for (const k in inst) { keys += k; delete inst.gb; delete inst.gc; } console.log(keys);`,
  "a typed array's every, find and toSorted behind callbacks that detach": show(`bytes.every(v => { ${detach} return true; }) + "," + String(new Uint8Array(4).find(() => false))`),
  "a typed array's toSorted behind a comparator that detaches": show(`String(bytes.toSorted((a, b) => { ${detach} return b - a; }))`),
  "a buffer's slice behind a start that detaches": show(`bytes.buffer.slice(${converting(detach, 1)}).byteLength`),
  "a buffer's resize behind a length that detaches": `const room = new ArrayBuffer(8, { maxByteLength: 16 }), view = new Uint8Array(room); ${show(`String(room.resize(${converting("structuredClone(room, { transfer: [room] });", 4)}))`)} ${show("sum(view) + ',' + view.length")}`,
  "a view's read behind an offset that detaches": show(`new DataView(bytes.buffer).getUint8(${converting(detach, 1)})`),
  "a store of a big integer behind a conversion that detaches": `const wide = new BigInt64Array(bytes.buffer); ${show(`String(wide.fill({ valueOf() { ${detach} return 7n; } }))`)} wide[0] = { valueOf() { return 1n; } };`,
  "a Buffer's stores behind values that detach": `const room = Buffer.alloc(8, 1), gone = () => { structuredClone(room.buffer, { transfer: [room.buffer] }); }; ${show(`room.writeUInt8(${converting("gone();", 7)}, 1)`)} ${show("sum(room) + ',' + room.length")}`,
  "a Buffer's wider stores behind values that detach": `const room = Buffer.alloc(16, 1), gone = () => { structuredClone(room.buffer, { transfer: [room.buffer] }); }; ${show(`room.writeDoubleLE(${converting("gone();", 7)}, 8)`)} ${show(`room.writeUInt32BE(${converting("", 7)}, 0)`)} ${show("sum(room) + ',' + room.length")}`,
  "a Buffer's fill behind a value that detaches": `const room = Buffer.alloc(8, 1); ${show(`String(room.fill(${converting("structuredClone(room.buffer, { transfer: [room.buffer] });", 7)}).length)`)} ${show("sum(room) + ',' + room.length")}`,
  "Buffer.concat behind a length out of valueOf": show(`Buffer.concat([Buffer.from(bytes.buffer)], ${converting(detach, 4)}).length`),

  // Operations of the language that read, run code of the program and then store.
  "an element added to behind a conversion that empties the array": `ints[2] += ${converting("ints.length = 0;", 1)}; doubles[0] -= ${converting(`doubles[0] = "s";`, 1)};`,
  "a field added to behind a conversion that deletes it": `inst.gc += ${converting("delete inst.gc;", 1)}; lit.lb *= ${converting(`lit.lb = "s"; delete lit.la;`, 2)};`,
  "an element of a typed array added to behind a conversion that detaches": `bytes[1] += ${converting(detach, 1)};`,
  "an element stored behind a value that grows the array": `const grow = a => { for (let i = 0; i < 5000; i++) a.push(i); return 7; }; ints[1] = grow(ints); doubles[2] = grow(doubles) + 0.5; console.log(ints.length, doubles.length); ints.length = 4; doubles.length = 3;`,
  "an element stored behind a value that empties the array": `const empty = a => { a.length = 0; return 7; }; ints[3] = empty(ints); objects[1] = (empty(objects), { qb: 9 });`,
  "an element stored behind a value that changes the kind of the array": `const change = (a, v) => { a[0] = v; return 7; }; ints[1] = change(ints, 0.5); doubles[1] = change(doubles, "s"); objects[1] = (change(objects, 1), { qb: 9 });`,
  "an element stored under an index that empties the array": `ints[(ints.length = 0, 2)] = 5; doubles[${converting("doubles.length = 0;", 1)}] = 2.5;`,
  "a field stored behind a value that deletes it": `inst.ga = (delete inst.ga, delete inst.gb, { qb: 9 }); lit.la = (delete lit.lb, { qb: 9 });`,
  "a field stored behind a value that freezes the object": `${show(`(() => { "use strict"; inst.gc = (Object.freeze(inst), 9); })()`)} ${show(`(() => { "use strict"; ints[0] = (Object.freeze(ints), 9); })()`)}`,
  "a pattern stores into elements while its source changes them": `[ints[0], ints[1], ints[2]] = { *[Symbol.iterator]() { yield "s"; ints.length = 1; yield 2; yield 3; } }; ({ a: doubles[0], b: doubles[2] } = { get a() { doubles.length = 0; return 1.5; }, b: null });`,
  "push of what empties the array": show(`ints.push((ints.length = 0, 5)) + "," + doubles.push(doubles.pop(), doubles.shift())`),
  "a loop whose bound shrinks the array": `const below = (a, bound) => { let t = 0; for (let i = 0; i < a.length; i++) if (a[i] < bound) t += a[i]; return t; }; ${show(`below(ints, ${converting("ints.length = 2;", 9)}) + "," + below(doubles, ${converting("doubles.pop();", 9)}) + "," + below([1, 2], 9)`)}`,
  "a loop whose bound detaches the typed array": `const below = (a, bound) => { let t = 0; for (let i = 0; i < a.length; i++) if (a[i] < bound) t += a[i]; return t; }; ${show(`below(bytes, ${converting(detach, 9)}) + "," + below(new Uint8Array([1, 2]), 9)`)}`,
  "two reads of a field around a stack that the program formats": `Error.prepareStackTrace = () => { lit.lb = 40; ints[0] = 50; inst.gc = 60.5; return "formatted"; }; const around = e => { const before = lit.lb + ints[0] + inst.gc; const text = e.stack; return before + "," + (lit.lb + ints[0] + inst.gc) + text; }; ${show("around(new Error())")}`,
  "two reads of a field around a comparison that converts": `const around = v => { const before = lit.lb + ints[0]; const less = v < 1; return before + "," + (lit.lb + ints[0]) + less; }; ${show(`around(${converting("lit.lb = 40; ints[0] = 50;")}) + around(0)`)}`,
  "two reads of a field around a test of a key that converts": `const around = k => { const before = lit.lb + ints[0]; const has = k in lit; return before + "," + (lit.lb + ints[0]) + has; }; ${show(`around({ toString() { lit.lb = 40; ints[0] = 50; return "la"; } }) + around("lb")`)}`,
  "two reads of a field around instanceof": `const around = (v, c) => { const before = lit.lb + ints[0]; const is = v instanceof c; return before + "," + (lit.lb + ints[0]) + is; }; ${show(`around(inst, { [Symbol.hasInstance]() { lit.lb = 40; ints[0] = 50; return true; } }) + around(inst, A)`)}`,
  "two reads of a field around a template": "const around = v => { const before = lit.lb + ints[0]; const text = `${v}`; return before + \",\" + (lit.lb + ints[0]) + text; }; console.log(attempt(() => around({ toString() { lit.lb = 40; ints[0] = 50; return \"t\"; } }) + around(1)));",
};

export const textOf = (name: string) => head + cases[name] + tail;

/** Classes and literals that hold the names which the programs use, each with other kinds of values: so many that a list of the shapes with one name passes a limit of the compiler. */
export function crowd(size: number): string {
  const lines = [`const all = [];`];
  for (let i = 0; i < size; i++) {
    lines.push(
      i % 2
        ? `all.push({ own${i}: ${i}, ga: { qb: ${i} }, gb: ${i}, gc: "c", la: ${i}.5, lb: { qb: "s" }, qb: ${i}, length: ${i}, lastIndex: ${i}, tag: null, got: true, x: ${i}, pq: "p", a: [${i}] });`
        : `all.push(new (class C${i} { own${i} = ${i}; qb = "q"; gc = { qb: ${i} }; gb = "b"; ga = ${i}; lb = null; la = [${i}]; x = { x: ${i} }; pq = ${i}; a = "a"; length = "l"; lastIndex = { qb: 1 }; tag = ${i}; got = ${i}.5; })());`,
    );
  }
  lines.push(
    `function touch(o) { return [o.ga, o.gb, o.gc, o.la, o.lb, o.qb, o.length, o.lastIndex, o.tag, o.got, o.x, o.pq, o.a].length; }`,
    `let touched = 0;`,
    `for (const o of all) touched += touch(o);`,
    `export default touched;`,
  );
  return lines.join("\n") + "\n";
}

export const textInCrowd = (name: string) => `import "./crowd.js";\n` + textOf(name);
