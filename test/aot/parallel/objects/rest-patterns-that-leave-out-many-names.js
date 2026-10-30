// A rest pattern that leaves out dozens of names copies what is left, in the order of creation, from sources with many sets and orders of keys.
const lines = [];
const show = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const { value, get, writable, enumerable, configurable } = Object.getOwnPropertyDescriptor(object, key);
      return String(key) + "=" + (get ? "getter" : String(value)) + (writable && enumerable && configurable ? "" : "!");
    })
    .join(",");

const tag = Symbol("tag");
const other = Symbol("other");
const taken = JSON.parse('["a0","a7","b3","c9","d3","b0"]');
const kept = JSON.parse('["width","height","margin","padding","gap","wrap","grow","shrink","basis","display","overflow","position"]');

function component({
  a0, a1, a2, a3, a4, a5, a6, a7, a8, a9,
  b0, b1, b2, b3, b4, b5, b6, b7, b8, b9,
  c0, c1, c2, c3, c4, c5, c6, c7, c8, c9,
  d0, d1, d2, d3,
  ...style
}) {
  style.wrap ??= "nowrap";
  style.grow ??= 0;
  return [style, (a0 ?? 0) + (a7 ?? 0) + (b3 ?? 0) + (c9 ?? 0) + (d3 ?? 0) + (b0 ?? 0)];
}

// The same first name and as many names as `component` leaves out.
function sibling({
  a0, e1, e2, e3, e4, e5, e6, e7, e8, e9,
  f0, f1, f2, f3, f4, f5, f6, f7, f8, f9,
  g0, g1, g2, g3, g4, g5, g6, g7, g8, g9,
  width, height, margin, padding,
  ...others
}) {
  return others;
}

const few = ({ a0, width, ...others }) => others;
const withComputedKey = (source, key) => {
  const { a0, [key]: value, b3, c9, a7, d3, b0, margin, gap, ...others } = source;
  return [others, value];
};

// A set and an order of keys for each seed.
function props(seed) {
  const object = {};
  for (let i = 0; i < kept.length; i++) {
    const index = (i * 5 + seed) % kept.length;
    if ((seed >> index % 7) & 1) object[kept[index]] = seed + index;
    if (i < taken.length && (seed >> i) & 1) object[taken[i]] = -seed - i;
  }
  return object;
}

function digest(text, hash) {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return hash;
}

function round(numberOfSeeds) {
  let hash = 7;
  let sum = 0;
  for (let seed = 0; seed < numberOfSeeds; seed++) {
    const source = props(seed);
    const before = show(source);
    const [style, total] = component(source);
    sum += total;
    hash = digest(show(style), hash);
    hash = digest(show(sibling(source)), hash);
    hash = digest(show(few(source)), hash);
    const [others, value] = withComputedKey(source, kept[seed % kept.length]);
    hash = digest(show(others) + String(value), hash);
    if (show(source) !== before) lines.push("the source changed: " + seed);
  }
  return hash + " " + sum;
}

// More sets of keys than any table of the run time holds at one place, met again at each turn.
const first = round(300);
for (let turn = 0; turn < 4; turn++) {
  if (turn === 2) Bun.gc(true);
  const next = round(300);
  if (next !== first) lines.push("turn " + turn + " differs: " + next);
}
lines.push(first);
for (const seed of [0, 1, 2, 3, 21, 42, 85, 127, 255, 299]) lines.push(seed + ": " + show(component(props(seed))[0]) + " | " + show(sibling(props(seed))));

class Box {
  #hidden = 1;
  a0 = 1;
  width = 2;
  b3 = 3;
  height = 4;
  get computed() {
    return this.#hidden;
  }
}

const log = [];
const sources = {
  literal: () => ({ a0: 1, width: 2, b1: 3, height: 4, d3: 5 }),
  literalInAnotherOrder: () => ({ height: 4, d3: 5, width: 2, a0: 1 }),
  onlyTakenNames: () => ({ a0: 1, b1: 2, c2: 3, d3: 4 }),
  nothing: () => ({}),
  instance: () => new Box(),
  instanceWithAddedNames: () => Object.assign(new Box(), { gap: 5, c9: 6, margin: 7 }),
  symbols: () => ({ a0: 1, [tag]: 2, width: 3, [other]: 4 }),
  indexes: () => ({ z: 0, 2: "two", a0: 1, 1: "one", width: 3 }),
  ownProto: () => JSON.parse('{"a0":1,"__proto__":2,"width":3}'),
  getter: () => Object.defineProperty({ a0: 1, width: 2 }, "gap", { get: () => (log.push("gap"), 7), enumerable: true, configurable: true }),
  takenGetter: () => Object.defineProperty({ width: 2 }, "a7", { get: () => (log.push("a7"), 7), enumerable: true, configurable: true }),
  notEnumerable: () => Object.defineProperty({ a0: 1, width: 2 }, "gap", { value: 7, enumerable: false, writable: true, configurable: true }),
  readOnly: () => Object.defineProperty({ a0: 1, width: 2 }, "gap", { value: 7, enumerable: true, writable: false, configurable: false }),
  frozen: () => Object.freeze({ a0: 1, width: 2, gap: 3 }),
  sealed: () => Object.seal(props(85)),
  deletedAndStoredAgain: () => {
    const object = props(127);
    delete object.width;
    delete object.a0;
    object.width = "again";
    object.a0 = "again";
    return object;
  },
  inherited: () => Object.create({ gap: 1, a0: 2 }, { width: { value: 3, enumerable: true, writable: true, configurable: true } }),
  noPrototype: () => Object.assign(Object.create(null), { a0: 1, width: 2, b3: 3 }),
  array: () => ["x", "y"],
  text: () => "ab",
  number: () => 5,
  func: () => Object.assign(() => {}, { a0: 1, width: 2 }),
  many: () => {
    const object = { a0: 1 };
    for (let n = 0; n < 80; n++) object["name" + n] = n;
    return object;
  },
  proxy: () =>
    new Proxy(
      { a0: 1, width: 2, gap: 3 },
      {
        ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)),
        getOwnPropertyDescriptor: (target, key) => (log.push("describe " + String(key)), Reflect.getOwnPropertyDescriptor(target, key)),
        get: (target, key) => (log.push("get " + String(key)), target[key]),
      },
    ),
  changesItself: () => {
    const object = { a0: 1, width: 2 };
    Object.defineProperty(object, "gap", { get: () => (delete object.margin, (object.late = 1), 3), enumerable: true, configurable: true });
    object.margin = 4;
    return object;
  },
};

const forms = {
  component: source => component(source)[0],
  sibling,
  few,
  computedName: source => withComputedKey(source, "width")[0],
  computedSymbol: source => withComputedKey(source, tag)[0],
  computedIndex: source => withComputedKey(source, 1)[0],
};

for (const [sourceName, make] of Object.entries(sources)) {
  for (const [formName, form] of Object.entries(forms)) {
    // Three times: what the first copy and the second one leave behind may serve the next.
    const results = [0, 1, 2].map(() => {
      log.length = 0;
      const rest = form(make());
      return show(rest) + " " + (Object.getPrototypeOf(rest) === Object.prototype) + " " + log.join(";");
    });
    const text = results[0].length > 300 ? String(digest(results[0], 7)) : results[0];
    lines.push(sourceName + " " + formName + " " + (results[1] === results[0] && results[2] === results[0] ? text : "DIFFERENT " + results.join(" | ")));
  }
}

for (const nothing of [null, undefined]) {
  for (const form of Object.values(forms)) {
    try {
      form(nothing);
      lines.push("no error");
    } catch (error) {
      lines.push(error instanceof TypeError ? "TypeError" : String(error));
    }
  }
}

// A rest object is an object of its own.
const shared = props(127);
const [one] = component(shared);
const [two] = component(shared);
one.width = "changed";
delete two.height;
two.added = 1;
lines.push(show(shared), show(one), show(two));

console.log(lines.join("\n"));
