// Built-ins that walk the elements of an object take short cuts where its storage says that no accessor stands under an index above it. Objects and arrays below such an accessor, linked to it in every way, go through each of those built-ins.
const values = Array.prototype[Symbol.iterator];
let log = [];

// The getter changes a later element, removes the last one and shortens its receiver: a built-in that read any of the three ahead of time prints something else.
function disturb(source) {
  log.push("get");
  source[2] = 20;
  delete source[3];
  source.length = 3;
  return 1;
}
function note(value) {
  log.push("set " + value);
}
const accessors = () => ({ get 1() { return disturb(this); }, set 1(value) { note(value); } });
const descriptor = () => ({ get() { return disturb(this); }, set(value) { note(value); }, enumerable: true, configurable: true });
const literal = () => ({ 0: 0, 2: 2, 3: 3, length: 4, [Symbol.iterator]: values, [Symbol.isConcatSpreadable]: true });

function elements(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) text += (i > 0 ? "," : "") + (i in list ? String(list[i]) : "hole");
  return "[" + text + "]";
}
function codes(text) {
  let listed = "";
  for (let i = 0; i < text.length; i++) listed += (i > 0 ? "," : "") + text.charCodeAt(i);
  return listed;
}
// Runs no getter: it asks for own properties only.
function own(object) {
  const members = Object.getOwnPropertyNames(object).map(name => name + ":" + String(Object.getOwnPropertyDescriptor(object, name).value));
  return members.join(" ") + " +" + Object.getOwnPropertySymbols(object).length;
}
function collect(...all) {
  return elements(all);
}
class Collected {
  constructor(...all) {
    this.text = elements(all);
  }
}
class Bytes extends Uint8Array {}

const natives = [
  ["new Int32Array", source => new Int32Array(source).join()],
  ["new of a class below Uint8Array", source => new Bytes(source).join()],
  ["Float64Array.from", source => Float64Array.from(source).join()],
  ["Float64Array.from with a function", source => Float64Array.from(source, value => value + 0.5).join()],
  ["set of a typed array", source => { const view = new Int32Array(4); view.set(source); return view.join(); }],
  ["Buffer.from", source => Buffer.from(source).join()],
  ["concat", source => elements(Array.prototype.concat.call([], source))],
  ["concat as the receiver", source => elements(Array.prototype.concat.call(source, 4))],
  ["slice", source => elements(Array.prototype.slice.call(source))],
  ["slice from 1", source => elements(Array.prototype.slice.call(source, 1))],
  ["includes 1", source => String(Array.prototype.includes.call(source, 1))],
  ["includes 2", source => String(Array.prototype.includes.call(source, 2))],
  ["includes undefined", source => String(Array.prototype.includes.call(source, undefined))],
  ["indexOf 2", source => String(Array.prototype.indexOf.call(source, 2))],
  ["indexOf 20", source => String(Array.prototype.indexOf.call(source, 20))],
  ["lastIndexOf 0", source => String(Array.prototype.lastIndexOf.call(source, 0))],
  ["at 1", source => String(Array.prototype.at.call(source, 1))],
  ["join", source => Array.prototype.join.call(source)],
  ["flat", source => elements(Array.prototype.flat.call(source))],
  ["toReversed", source => elements(Array.prototype.toReversed.call(source))],
  ["toSorted", source => elements(Array.prototype.toSorted.call(source))],
  ["toSpliced", source => elements(Array.prototype.toSpliced.call(source, 0, 0))],
  ["with", source => elements(Array.prototype.with.call(source, 0, 9))],
  ["map", source => elements(Array.prototype.map.call(source, value => value))],
  ["filter", source => elements(Array.prototype.filter.call(source, () => true))],
  ["forEach", source => { let text = ""; Array.prototype.forEach.call(source, (value, index) => { text += index + "=" + value + ";"; }); return text; }],
  ["reduce", source => Array.prototype.reduce.call(source, (text, value) => text + value + ";", "")],
  ["reduceRight", source => Array.prototype.reduceRight.call(source, (text, value) => text + value + ";", "")],
  ["findIndex", source => String(Array.prototype.findIndex.call(source, value => value === undefined))],
  ["findLastIndex", source => String(Array.prototype.findLastIndex.call(source, value => value === 20))],
  ["every", source => String(Array.prototype.every.call(source, value => value < 10))],
  ["Reflect.apply", source => Reflect.apply(collect, null, source)],
  ["apply", source => collect.apply(null, source)],
  ["Reflect.construct", source => Reflect.construct(Collected, source).text],
  ["Math.max.apply", source => String(Math.max.apply(null, source))],
  ["Reflect.apply of Math.min", source => String(Reflect.apply(Math.min, null, source))],
  ["String.fromCharCode.apply", source => codes(String.fromCharCode.apply(null, source))],
  ["Array.apply", source => elements(Array.apply(null, source))],
  ["Reflect.construct of Array", source => elements(Reflect.construct(Array, source))],
  ["push.apply", source => { const list = []; Array.prototype.push.apply(list, source); return elements(list); }],
  ["String.raw", source => String.raw({ raw: source }, "a", "b", "c")],
  ["new Set", source => elements([...new Set(source)])],
  ["Object.groupBy", source => Object.keys(Object.groupBy(source, value => value)).join()],
  ["Array.from", source => elements(Array.from(source))],
  ["Array.from with a function", source => elements(Array.from(source, value => value + 0.5))],
  ["spread into an array", source => elements([...source])],
  ["spread into arguments", source => collect(...source)],
  ["spread into Math.max", source => String(Math.max(...source))],
  ["spread into new", source => new Collected(...source).text],
  ["for of", source => { let text = ""; for (const value of source) text += value + ";"; return text; }],
  ["array pattern", source => { const [first, second, third, fourth] = source; return collect(first, second, third, fourth); }],
  ["array pattern with a rest", source => { const [first, ...rest] = source; return first + " " + elements(rest); }],
  ["Object.assign from it", source => own(Object.assign({}, source))],
  ["Object.assign from it onto an array", source => own(Object.assign([], source))],
  ["Object.assign onto it", source => { Object.assign(source, { 1: 5, 4: 6 }); return "done"; }],
  ["Object.assign of an array onto it", source => { Object.assign(source, [7, 8]); return "done"; }],
  ["object spread", source => own({ ...source })],
  ["object rest", source => { const { 0: first, ...rest } = source; return first + " " + own(rest); }],
  ["Object.keys", source => Object.keys(source).join()],
  ["Object.values", source => Object.values(source).join()],
  ["Object.entries", source => JSON.stringify(Object.entries(source))],
  ["for in", source => { let text = ""; for (const key in source) text += key + ";"; return text; }],
  ["JSON.stringify", source => JSON.stringify(source)],
  ["structuredClone", source => own(structuredClone(source))],
  ["fill", source => { Array.prototype.fill.call(source, 9); return "done"; }],
  ["reverse", source => { Array.prototype.reverse.call(source); return "done"; }],
  ["sort", source => { Array.prototype.sort.call(source); return "done"; }],
  ["copyWithin", source => { Array.prototype.copyWithin.call(source, 0, 1); return "done"; }],
  ["shift", source => String(Array.prototype.shift.call(source))],
  ["unshift", source => String(Array.prototype.unshift.call(source, 9))],
  ["splice", source => elements(Array.prototype.splice.call(source, 1, 1))],
  ["push at the index of the accessor", source => { source.length = 1; return String(Array.prototype.push.call(source, 7)); }],
];

// A row: the way, the built-in, its answer, the calls of the accessor, what the object holds afterwards.
function run(ways) {
  for (const [way, make] of ways) {
    for (const [name, native] of natives) {
      log = [];
      const source = make();
      let answer;
      try {
        answer = native(source);
      } catch (error) {
        answer = "threw " + error.name;
      }
      console.log(way + " | " + name + " | " + answer + " | " + log.join() + " | " + own(source));
    }
  }
}

// The accessor is there before its holder becomes a prototype.
run([
  ["setPrototypeOf", () => Object.setPrototypeOf(literal(), accessors())],
  ["Reflect.setPrototypeOf", () => { const source = literal(); Reflect.setPrototypeOf(source, accessors()); return source; }],
  ["store to __proto__", () => { const source = literal(); source.__proto__ = accessors(); return source; }],
  ["__proto__: first", () => ({ __proto__: { get 1() { return disturb(this); }, set 1(value) { note(value); } }, 0: 0, 2: 2, 3: 3, length: 4, [Symbol.iterator]: values, [Symbol.isConcatSpreadable]: true })],
  ["__proto__: last", () => ({ 0: 0, 2: 2, 3: 3, length: 4, [Symbol.iterator]: values, [Symbol.isConcatSpreadable]: true, __proto__: { get 1() { return disturb(this); }, set 1(value) { note(value); } } })],
  ["two levels up", () => Object.setPrototypeOf(literal(), { __proto__: accessors() })],
  ["prototype from Object.create", () => Object.setPrototypeOf(literal(), Object.defineProperty(Object.create(Object.prototype), 1, descriptor()))],
  ["object from Object.create", () => {
    const source = Object.create(accessors());
    source[0] = 0;
    source[2] = 2;
    source[3] = 3;
    source.length = 4;
    source[Symbol.iterator] = values;
    source[Symbol.isConcatSpreadable] = true;
    return source;
  }],
  // Plain Bun keeps its short cuts for an object that has no element when the built-in looks at it.
  ["no own elements", () => Object.setPrototypeOf({ length: 4, [Symbol.iterator]: values, [Symbol.isConcatSpreadable]: true }, { 0: 0, get 1() { return disturb(this); }, set 1(value) { note(value); }, 2: 2, 3: 3 })],
  ["array", () => Object.setPrototypeOf([0, , 2, 3], { __proto__: Array.prototype, get 1() { return disturb(this); }, set 1(value) { note(value); } })],
]);

// The classes are evaluated here, behind the rows above: no prototype object of a class has an accessor under an index while those run.
class Above {
  get 1() { return disturb(this); }
  set 1(value) { note(value); }
}
class Heir extends Above {
  constructor() {
    super();
    this[0] = 0;
    this[2] = 2;
    this[3] = 3;
    this.length = 4;
    this[Symbol.iterator] = values;
    this[Symbol.isConcatSpreadable] = true;
  }
}
run([["class instance", () => new Heir()]]);

// The accessor arrives above an object that already is a prototype, so from here on the realm of plain Bun is having a bad time. These ways stay last.
run([
  ["defined after the link", () => {
    const above = {};
    const source = Object.setPrototypeOf(literal(), above);
    Object.defineProperty(above, 1, descriptor());
    return source;
  }],
  ["linked above after the link", () => {
    const above = {};
    const source = Object.setPrototypeOf(literal(), above);
    Object.setPrototypeOf(above, accessors());
    return source;
  }],
  ["class instance, defined after the link", () => {
    class Base {}
    class Late extends Base {
      constructor() {
        super();
        this[0] = 0;
        this[2] = 2;
        this[3] = 3;
        this.length = 4;
        this[Symbol.iterator] = values;
        this[Symbol.isConcatSpreadable] = true;
      }
    }
    const source = new Late();
    Object.defineProperty(Base.prototype, 1, descriptor());
    return source;
  }],
  ["array, defined after the link", () => {
    const above = { __proto__: Array.prototype };
    const source = Object.setPrototypeOf([0, , 2, 3], above);
    Object.defineProperty(above, 1, descriptor());
    return source;
  }],
]);
