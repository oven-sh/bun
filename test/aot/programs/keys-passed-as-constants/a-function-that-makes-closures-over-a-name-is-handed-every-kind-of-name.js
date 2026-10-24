// A function that makes a closure over its parameter, where the closure uses the parameter as a key, is called with written texts and with everything else.
const lines = [];
const say = (...parts) => lines.push(parts.map(part => (typeof part === "symbol" ? part.toString() : String(part))).join(" "));
function reader(name) {
  return function (from) {
    return from[name];
  };
}
function writer(name) {
  return function (into, value) {
    into[name] = value;
    return name in into;
  };
}
function remover(name) {
  return function (from) {
    return delete from[name];
  };
}
const hidden = process.argv.length > 9 ? "x" : "";
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
const mark = Symbol("mark");
const box = { width: 1, height: 2, 0: "zero", 7: "seven", "-1": "minus", "1.5": "half", "": "empty", [mark]: "marked", undefined: "u", null: "n", true: "t" };
// Written texts.
say(reader("width")(box), reader("height")(box), reader("depth")(box));
// Texts that are indexes, nearly indexes, empty.
say(reader("0")(box), reader("7")(box), reader("-1")(box), reader("1.5")(box), reader("")(box), reader("00")(box), reader("4294967295")(box), reader("4294967294")([1]));
say(reader("0")("ab"), reader("length")("ab"), reader("1")([5, 6]), reader("length")([5, 6]));
// The same texts, made at run time: ropes, texts out of other texts, numbers, symbols, objects that turn into texts.
say(reader("wid" + hidden + "th")(box), reader(["height"].join(hidden))(box), reader(`${hidden}width`)(box), reader("xwidth".slice(1))(box));
say(reader(0)(box), reader(7)(box), reader(-1)(box), reader(1.5)(box), reader(mark)(box), reader(undefined)(box), reader(null)(box), reader(true)(box), reader()(box));
let turned = 0;
const turning = {
  toString() {
    turned++;
    return "width";
  },
};
const readTurning = reader(turning);
say(readTurning(box), readTurning(box), turned);
say(reader(new String("height"))(box), reader(Object("width"))(box));
// __proto__, constructor, prototype.
const above = { inherited: "from above" };
const below = { __proto__: above, own: 1 };
say(reader("__proto__")(below) === above, reader("constructor")(below) === Object, reader("inherited")(below), reader("prototype")(function () {}) !== undefined);
const target = {};
say(writer("__proto__")(target, above), Object.getPrototypeOf(target) === above, Object.keys(target).length, target.inherited);
say(writer("width")(target, 3), target.width, writer("0")(target, "z"), target[0], writer(mark)(target, 1), target[mark]);
say(remover("width")(target), "width" in target, remover("missing")(target), remover("0")(target), 0 in target);
// Frozen, sealed, accessors that throw, proxies.
const frozen = Object.freeze({ width: 1 });
say(attempt(() => writer("width")(frozen, 9)), attempt(() => writer("wid" + hidden + "th")(frozen, 9)), frozen.width, attempt(() => remover("width")(frozen)), attempt(() => remover(hidden + "width")(frozen)));
const throwing = {
  get width() {
    throw new RangeError("no width");
  },
};
for (const read of [reader("width"), reader("wid" + hidden + "th")]) {
  try {
    say(read(throwing));
  } catch (error) {
    say(error.constructor.name, error.message);
  }
}
const seen = [];
const watched = new Proxy(
  { width: 4 },
  {
    get(of, key, receiver) {
      seen.push("get " + String(key));
      return Reflect.get(of, key, receiver);
    },
    set(of, key, value, receiver) {
      seen.push("set " + String(key));
      return Reflect.set(of, key, value, receiver);
    },
    has(of, key) {
      seen.push("has " + String(key));
      return Reflect.has(of, key);
    },
    deleteProperty(of, key) {
      seen.push("delete " + String(key));
      return Reflect.deleteProperty(of, key);
    },
  },
);
say(reader("width")(watched), writer("width")(watched, 5), remover("width")(watched), seen.join());
// undefined and null as what is read from.
for (const nothing of [undefined, null]) {
  try {
    reader("width")(nothing);
  } catch (error) {
    say(error.constructor.name);
  }
}
// What the functions themselves look like.
say(reader.name, reader.length, reader("width").name, reader("width").length, reader("width") === reader("width"), reader("width").toString() === reader(hidden + "q").toString());
say(typeof reader.prototype, new reader("width")(box), reader.call({ any: 1 }, "height")(box), reader.apply(null, ["width", "more"])(box), Reflect.apply(reader, undefined, ["height"])(box));
say(reader.bind(null, "width")()(box), [..."ab"].map(reader).length, ["width", "height"].map(reader).map(read => read(box)).join());
// The stack of an error thrown inside names each function once.
function thrower(name) {
  return function (from) {
    if (from[name] === undefined) throw new Error("nothing under " + name);
    return from[name];
  };
}
function failing(name) {
  if (name === "width") throw new Error("refused " + name);
  return function (from) {
    return from[name];
  };
}
for (const make of [() => thrower("depth")(box), () => failing("width"), () => failing("wid" + hidden + "th")]) {
  try {
    make();
  } catch (error) {
    say(error.message, error.stack.split("\n").filter(line => /thrower|failing/.test(line)).length);
  }
}
console.log(lines.join("\n"));
