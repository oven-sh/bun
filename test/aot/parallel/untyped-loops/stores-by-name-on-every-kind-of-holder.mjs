function store(o, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    o.n = i + 0.5;
    s += i;
  }
  return s;
}

function count(o, n) {
  for (let i = 0; i < n; i++) o.n++;
  return o.n;
}

function both(o, p, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    o.n = i;
    s += p.n;
  }
  return s;
}

const text = process.argv.length > 9 ? "" : '{"a":1,"n":2,"b":"t"}';
const parse = () => JSON.parse(text);
const one = text.replace('"a":1,', "");
const withName = target => Object.assign(target, JSON.parse(one));
const prototypeOf = parse();
let heard = [];
const accessorPrototype = Object.defineProperty({}, "n", { get: () => 8, set: value => heard.push("prototype " + value) });
const kinds = {
  parsed: parse,
  frozen: () => Object.freeze(parse()),
  sealed: () => Object.seal(parse()),
  closed: () => Object.preventExtensions(parse()),
  readOnly: () => Object.defineProperty(parse(), "n", { writable: false }),
  readOnlyBeside: () => Object.defineProperty(parse(), "a", { writable: false }),
  accessor: () => Object.defineProperty(parse(), "n", { get: () => 4, set: value => heard.push("set " + value) }),
  accessorBeside: () => Object.defineProperty(parse(), "a", { get: () => 4, set: value => heard.push("beside " + value) }),
  getterAlone: () => Object.defineProperty(parse(), "n", { get: () => 5, configurable: true }),
  hidden: () => Object.defineProperty(parse(), "n", { enumerable: false }),
  above: () => Object.create(parse()),
  aboveFrozen: () => Object.create(Object.freeze(parse())),
  aboveAccessor: () => Object.create(Object.defineProperty(parse(), "n", { get: () => 6, set: value => heard.push("above " + value) })),
  prototype: () => prototypeOf,
  withoutPrototype: () => withName(Object.create(null)),
  accessorAbove: () => Object.setPrototypeOf(parse(), accessorPrototype),
  accessorAboveAlone: () => Object.create(accessorPrototype),
  array: () => withName([1, 2, 3]),
  callable: () => withName(() => 1),
  error: () => withName(new Error("e")),
  map: () => withName(new Map()),
  view: () => withName(new Uint8Array(4)),
  expression: () => withName(/x/),
  proxy: () => new Proxy(parse(), {}),
  hearingProxy: () => new Proxy(parse(), { set(target, key, value) { heard.push(String(key) + value); target[key] = value; return true; } }),
  dictionary: () => {
    const o = parse();
    for (let i = 0; i < 80; i++) o["key" + i] = i;
    delete o.key7;
    return o;
  },
  removed: () => {
    const o = parse();
    delete o.n;
    return o;
  },
  removedAndBack: () => {
    const o = parse();
    delete o.n;
    o.n = 9;
    return o;
  },
  text: () => Object.assign(parse(), JSON.parse(one.replace("2", '"12"'))),
  large: () => { const o = parse(); o[key] = 9007199254740991n; return o; },
  nothing: () => { const o = parse(); o[key] = undefined; return o; },
  symbolBeside: () => Object.assign(parse(), { [Symbol.iterator]: 1 }),
  number: () => 5,
  string: () => "text",
  global: () => withName(globalThis),
};

const show = value => (typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "string" ? '"' + value + '"' : String(value));
const key = process.argv.length > 9 ? "a" : "n";
const ops = { store, count, both, read: holder => holder.n };
function attempt(f) {
  try {
    return show(f());
  } catch (error) {
    return error.name;
  }
}

Object.create(prototypeOf);
for (const name in kinds) {
  const line = [];
  for (const turns of [0, 1, 3, 9]) {
    const holder = kinds[name]();
    const other = kinds[name]();
    heard = [];
    for (let k = 0; k < 4; k++) attempt(() => ops.read(holder));
    line.push(attempt(() => ops.read(holder)), attempt(() => ops.store(holder, turns)), attempt(() => ops.read(holder)), attempt(() => ops.count(other, turns)), attempt(() => ops.read(other)), attempt(() => ops.both(holder, turns & 1 ? holder : other, turns)), attempt(() => ops.read(holder)), attempt(() => Object.keys(Object(holder)).filter(key => key.length < 5 || key === "key7").slice(0, 6).join()), heard.length + (heard[heard.length - 1] ?? ""));
  }
  console.log(name, line.join(" "));
}

const late = [parse(), parse(), parse(), parse()];
const answers = [];
for (let round = 0; round < late.length; round++) {
  for (const holder of late) answers.push(attempt(() => ops.store(holder, 5)), attempt(() => ops.read(holder)));
  Object.freeze(late[round]);
}
console.log(answers.join(" "));
