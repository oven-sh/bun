// A printer of the host looks for a method under Symbol.for("nodejs.util.inspect.custom") and prints what it answers.
// Every printer, reached in every way, is handed a value that has come by the method in every way. One line for a printer and a way: a mark for each value.
import util from "node:util";

const custom = Symbol.for("nodejs.util.inspect.custom");

function shown(depth, options, inspect) {
  return "shown " + typeof inspect;
}

class ByBun {
  [Bun.inspect.custom](depth, options, inspect) {
    return "shown " + typeof inspect;
  }
}
class ByUtil {
  [util.inspect.custom](depth, options, inspect) {
    return "shown " + typeof inspect;
  }
}
class BySymbol {
  [custom](depth, options, inspect) {
    return "shown " + typeof inspect;
  }
}
class ByParsedText {
  [Symbol.for(JSON.parse('"nodejs.util.inspect.custom"'))](depth, options, inspect) {
    return "shown " + typeof inspect;
  }
}
class Below extends BySymbol {}
class OnTheClass {
  static [custom](depth, options, inspect) {
    return "shown " + typeof inspect;
  }
}
class ByGetter {
  get [custom]() {
    return shown;
  }
}
class ByField {
  [custom] = shown;
}
function Constructed() {}
Constructed.prototype[custom] = shown;

const stores = [
  () => new ByBun(),
  () => new ByUtil(),
  () => new BySymbol(),
  () => new ByParsedText(),
  () => new Below(),
  () => OnTheClass,
  () => new ByGetter(),
  () => new ByField(),
  () => new Constructed(),
  () => ({ [custom]: shown }),
  () => ({ [Bun.inspect.custom]: shown }),
  () => ({
    [custom](depth, options, inspect) {
      return "shown " + typeof inspect;
    },
  }),
  () => ({
    get [custom]() {
      return shown;
    },
  }),
  () => {
    const value = {};
    value[custom] = shown;
    return value;
  },
  () => {
    const value = {};
    value[Bun.inspect.custom] = shown;
    return value;
  },
  () => Object.defineProperty({}, custom, { value: shown }),
  () => Object.defineProperty({}, custom, { get: () => shown }),
  () => Object.defineProperties({}, { [custom]: { value: shown } }),
  () => {
    const value = {};
    Reflect.defineProperty(value, custom, { value: shown });
    return value;
  },
  () => {
    const value = {};
    Reflect.set(value, custom, shown);
    return value;
  },
  () => Object.assign({}, { [custom]: shown }),
  () => ({ ...{ [custom]: shown } }),
  () => Object.fromEntries([[custom, shown]]),
  () => Object.create({}, { [custom]: { value: shown } }),
  () => Object.create({ [custom]: shown }),
  () => Object.setPrototypeOf({}, { [custom]: shown }),
  () => ({ __proto__: { [custom]: shown } }),
  () => Object.assign(() => {}, { [custom]: shown }),
  () => Object.assign([1], { [custom]: shown }),
  () => Object.assign(new RangeError("no"), { [custom]: shown }),
  () => ({ [custom]: shown.bind(null) }),
  () => new Proxy({}, { get: (target, key) => (key === custom ? shown : undefined) }),
  () => {
    const source = { [custom]: shown };
    const value = {};
    for (const key of Reflect.ownKeys(source)) value[key] = source[key];
    return value;
  },
  () => [{ [custom]: shown }],
  () => ({ inner: { [custom]: shown } }),
  () => new Map([[1, { [custom]: shown }]]),
  () => new Set([{ [custom]: shown }]),
  () => ({
    get inner() {
      return { [custom]: shown };
    },
  }),
];

const ways = [
  (print, value) => print(value),
  (print, value) => print.call(undefined, value),
  (print, value) => print.apply(undefined, [value]),
  (print, value) => print.bind(undefined)(value),
  (print, value) => print.bind(undefined, value)(),
  (print, value) => print.bind(undefined).bind(null)(value),
  (print, value) => Reflect.apply(print, undefined, [value]),
  (print, value) => Function.prototype.call.call(print, undefined, value),
  (print, value) => Function.prototype.call.bind(print)(undefined, value),
  (print, value) => Function.prototype.apply.call(print, undefined, [value]),
  (print, value) => Reflect.apply(Function.prototype.call, print, [undefined, value]),
  (print, value) => print(...[value]),
  (print, value) => new Proxy(print, {})(value),
  (print, value) => [print][JSON.parse("0")](value),
  (print, value) => print([value][JSON.parse("0")]),
  (print, value) => print(new Map([[1, value]]).get(1)),
  (print, value) => [value].map(each => print(each))[0],
  (print, value) => Array.from([value], each => print(each))[0],
  async (print, value) => print(await Promise.resolve(value)),
  (print, value) => Promise.resolve(value).then(print),
];

const answering = [
  ["Bun.inspect", Bun.inspect],
  ["Bun.inspect.table", Bun.inspect.table],
  ["util.inspect", util.inspect],
  ["util.format", util.format],
  ["util.formatWithOptions", (...values) => util.formatWithOptions({}, ...values)],
];

for (const [name, print] of answering) {
  for (let way = 0; way < ways.length; way++) {
    let marks = "";
    for (const store of stores) marks += String(await ways[way](print, store())).includes("shown function") ? "+" : "-";
    console.log(name, way, marks);
  }
}

// The printers of the console write to the terminal themselves.
const writing = [console.log, console.info, console.debug, console.dir, console.table];
for (const print of writing) {
  for (let way = 0; way < ways.length; way++) {
    console.log(print.name, way);
    for (const store of stores) await ways[way](print, store());
  }
}
console.log("%o|%O|%s", new BySymbol(), new ByBun(), new ByGetter());
console.log(util.format("%o|%O|%s", new BySymbol(), new ByBun(), new ByGetter()));
