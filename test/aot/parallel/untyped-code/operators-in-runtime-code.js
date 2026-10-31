// Evaluated text compares with === and !==, adds, asks typeof and length, branches and calls, on values of every kind and in instructions of all three widths.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);

// An instruction is as wide as its widest operand, and the variables of a block get their registers behind every `var` of the function.
const padding = count => (count ? "var " + Array.from({ length: count }, (_, index) => "p" + index).join() + ";" : "");
function operatorsOf(count) {
  const make = body => new Function("a", "b", padding(count) + "{ let x = a, y = b; " + body + " }");
  const branch = condition => make("if (" + condition + ") return true; return false;");
  const loop = condition => make("let turns = 0; do { if (++turns > 1) return true; } while (" + condition + "); return false;");
  return {
    same: make("return x === y;"),
    different: make("return x !== y;"),
    ifSame: branch("x === y"),
    ifDifferent: branch("x !== y"),
    whileSame: loop("x === y"),
    whileDifferent: loop("x !== y"),
    sum: make("return x + y;"),
    append: make("x += y; return x;"),
    typeOf: make("return typeof x;"),
    isFunction: make("return typeof x === 'function';"),
    isNoFunction: make("return typeof x !== 'function';"),
    ifFunction: branch("typeof x === 'function'"),
    isObject: make("return typeof x === 'object';"),
    isNoObject: make("return typeof x !== 'object';"),
    ifObject: branch("typeof x === 'object'"),
    lengthOf: make("return x.length;"),
    ifTruthy: branch("x"),
    ifFalsy: branch("!x"),
    whileTruthy: loop("x"),
    choose: make("return x ? 1 : 2;"),
    and: make("return x && y;"),
    or: make("return x || y;"),
    call: make("return x(y, 2);"),
  };
}
const widths = [["narrow", operatorsOf(0)], ["wide16", operatorsOf(200)], ["wide32", operatorsOf(33000)]];
const narrow = widths[0][1];

const describe = value =>
  typeof value === "string" ? (value.length > 16 ? JSON.stringify(value.slice(0, 4) + ".." + value.slice(-4)) + value.length : JSON.stringify(value))
  : typeof value === "bigint" ? value + "n"
  : typeof value === "symbol" ? value.toString()
  : typeof value === "function" ? "function"
  : typeof value === "object" && value !== null ? "object"
  : Object.is(value, -0) ? "-0"
  : String(value);
const attempt = run => {
  try {
    return describe(run());
  } catch (error) {
    return "!" + error.constructor.name;
  }
};
const brief = run => {
  try {
    return (typeof run())[0];
  } catch (error) {
    return error.constructor.name[0];
  }
};
const complete = run => {
  try {
    const value = run();
    return typeof value === "string" ? value : describe(value);
  } catch (error) {
    return "!" + error.constructor.name;
  }
};
const agree = answers => (answers.every(answer => answer === answers[0]) ? answers[0] : "?");

// The compiler knows nothing about what comes out of JSON.parse. What the text joins is a rope, what it slices is a part of another string.
const source = JSON.parse('{"g":"G","et":"ET","get":"GET","padded":"xxGETxx","lower":"get","han":"中文","left":"中","right":"文","letters":"abcdefghijklmnopqrstuvwxyz0123456789","one":"1","thirty":"1000000000000000000000000000000"}');
const sumInText = narrow.sum;
const sliceInText = new Function("text", "from", "to", "return text.slice(from, to);");
const atom = text => Object.keys({ [text]: 1 })[0];
const fresh = text => text.split("").join("");
const fromCodes = text => String.fromCharCode(...Array.from(text, character => character.charCodeAt(0)));
const parsed = text => JSON.parse(JSON.stringify(text));
const wide = text => (typeof Buffer === "function" ? Buffer.from(text, "utf16le").toString("utf16le") : ("Ā" + text).substring(1));
const rope = text => (text.length < 2 ? text : sumInText(fresh(text.slice(0, 1)), fresh(text.slice(1))));
const sliced = text => sliceInText("__" + text + "__", 2, 2 + text.length);
const long = source.letters.repeat(14);

const arrow = (a, b) => "arrow " + a + " " + b;
const withProperties = (a, b) => "with properties " + a + " " + b;
withProperties.extra = 1;
function declared(a, b) { return "declared " + typeof this + " " + a + " " + b; }
function fewer(a) { return "fewer " + a + " " + arguments.length; }
function more(a, b, c, d) { return "more " + [a, b, c, d].join(); }
function rest(...all) { return "rest " + all.join(); }
function defaults(a, b, c = "third") { return "defaults " + a + " " + b + " " + c; }
function thrower() { throw new RangeError("thrown"); }
function Legacy(a, b) { if (!new.target) return "Legacy " + a + " " + b; this.a = a; }
function Constructed(a, b) { if (!(this instanceof Constructed)) return "Constructed " + a + " " + b; this.a = a; }
function* generator(a, b) { yield a; yield b; }
async function later(a, b) { return a; }
class Base {
  constructor(a) { this.a = a; }
  method(a, b) { return "method " + typeof this + " " + a + " " + b; }
  static make(a, b) { return "static " + a + " " + b; }
  get got() { return "got"; }
}
class Derived extends Base {}
class Sized { length = 5; }
class Callable extends Function {}
const inText = new Function("a", "b", "return 'in text ' + a + ' ' + b;");
const getter = Object.getOwnPropertyDescriptor(Base.prototype, "got").get;
const callable = new Callable();
const bound = declared.bind("receiver", "first"), boundArrow = arrow.bind(null, "first"), boundNative = Math.max.bind(null, 5), boundClass = Base.bind(null), boundInText = inText.bind(null, "first"), boundTwice = bound.bind(null, "second");
const proxyOfArrow = new Proxy(arrow, {}), proxyOfConstructed = new Proxy(Constructed, {}), proxyOfClass = new Proxy(Base, {}), proxyOfNative = new Proxy(Math.max, {}), proxyOfInText = new Proxy(inText, {});
const trapping = new Proxy(arrow, { apply: (target, receiver, list) => "trapped " + list.join() });
const revocable = Proxy.revocable(arrow, {});
revocable.revoke();

const symbol = Symbol("s"), object = { a: 1 }, array = [0], bare = Object.create(null), date = new Date(0), pattern = /x/, map = new Map(), bytes = new Uint8Array(3);
const instance = new Base("a"), sized = new Sized(), legacy = new Legacy(1), constructed = new Constructed(1), proxyOfObject = new Proxy({}, {});
const boxedText = new String("GET"), boxedBigInt = Object(1n), boxedSymbol = Object(Symbol.iterator), passed = (function () { return arguments; })(1, 2);
const withValueOf = { valueOf: () => 7 }, withToString = { toString: () => "mine" }, withToPrimitive = { [Symbol.toPrimitive]: hint => "hint " + hint }, withLength = { get length() { return 42; } };

// [name, what makes the value anew, whether its text is the text of a function or depends on the time zone]
const operands = [
  ["undefined", () => undefined], ["null", () => null], ["true", () => true], ["false", () => false],
  ["0", () => 0], ["-0", () => -0], ["1", () => 1], ["-1", () => -1], ["2147483647", () => 2147483647], ["-2147483648", () => -2147483648], ["2147483648", () => 2147483648],
  ["0.5", () => 0.5], ["-0.5", () => -0.5], ["1.5", () => 1.5], ["1e308", () => 1e308], ["5e-324", () => 5e-324], ["NaN", () => NaN], ["Infinity", () => Infinity], ["-Infinity", () => -Infinity],
  ["0 as a double", () => sumInText(0.5, -0.5)], ["1 as a double", () => sumInText(0.5, 0.5)], ["-1 as a double", () => sumInText(-0.5, -0.5)], ["NaN of a sum", () => sumInText(Infinity, -Infinity)],
  ["empty", () => ""], ["empty, sliced", () => sliceInText(source.get, 1, 1)], ["empty, joined", () => [].join("")],
  ["a", () => "a"], ["G", () => source.g], ["G, from codes", () => fromCodes(source.g)],
  ["GET", () => "GET"], ["GET, atom", () => atom(source.get)], ["GET, fresh", () => fresh(source.get)], ["GET, from codes", () => fromCodes(source.get)], ["GET, parsed", () => parsed(source.get)],
  ["GET, rope", () => sumInText(source.g, source.et)], ["GET, sliced", () => sliceInText(source.padded, 2, 5)], ["GET, 16 bits", () => wide(source.get)], ["GET, upper case", () => source.lower.toUpperCase()],
  ["GEt", () => fresh("GEt")], ["get", () => source.lower], ["GETS", () => sumInText(source.get, "S")],
  ["é", () => "é"], ["中文", () => "中文"], ["中文, fresh", () => fresh(source.han)], ["中文, rope", () => sumInText(source.left, source.right)], ["a中, rope", () => sumInText("a", source.left)], ["a lone surrogate", () => "\ud800"],
  ["32 letters", () => fresh(source.letters.slice(0, 32))], ["32 letters, rope", () => rope(source.letters.slice(0, 32))], ["33 letters", () => fresh(source.letters.slice(0, 33))], ["33 letters, sliced", () => sliced(source.letters.slice(0, 33))],
  ["504 letters", () => fresh(long)], ["504 letters, rope", () => rope(long)], ["504 letters, 16 bits", () => wide(long)],
  ["the text 1", () => source.one], ["the text 0", () => "0"], ["the text NaN", () => "NaN"], ["the text undefined", () => "undefined"], ["the text null", () => "null"],
  ["0n", () => 0n], ["1n", () => 1n], ["1n, made", () => BigInt(source.one)], ["-1n", () => -1n], ["10n ** 30n", () => BigInt(source.thirty)],
  ["a symbol", () => symbol], ["a new symbol", () => Symbol("s")], ["Symbol.iterator", () => Symbol.iterator], ["a registered symbol", () => Symbol.for("registered")],
  ["an object", () => object], ["a new object", () => ({ a: 1 })], ["an array", () => array], ["an object without a prototype", () => bare], ["a date", () => date, true], ["a regular expression", () => pattern], ["a map", () => map], ["bytes", () => bytes],
  ["an instance", () => instance], ["an instance with a length", () => sized], ["an instance of a function", () => constructed], ["another instance of a function", () => legacy], ["a proxy of an object", () => proxyOfObject],
  ["a String object", () => boxedText], ["a BigInt object", () => boxedBigInt], ["a Symbol object", () => boxedSymbol], ["arguments", () => passed],
  ["valueOf", () => withValueOf], ["toString", () => withToString], ["Symbol.toPrimitive", () => withToPrimitive], ["a getter of length", () => withLength],
  ["an arrow function", () => arrow, true], ["a function with a property", () => withProperties, true], ["a function", () => declared, true], ["fewer parameters", () => fewer, true], ["more parameters", () => more, true],
  ["rest parameters", () => rest, true], ["default parameters", () => defaults, true], ["a function that throws", () => thrower, true], ["a function that reads new.target", () => Legacy, true], ["a function that is constructed", () => Constructed, true],
  ["a generator function", () => generator, true], ["an async function", () => later, true], ["a class", () => Base, true], ["a derived class", () => Derived, true], ["a method", () => Base.prototype.method, true], ["a static method", () => Base.make, true],
  ["a getter", () => getter, true], ["a new closure", () => (a, b) => "new closure " + a + " " + b, true], ["a function of the text", () => inText, true], ["an instance of a subclass of Function", () => callable, true],
  ["Math.max", () => Math.max, true], ["Object", () => Object, true], ["Map", () => Map, true], ["Function.prototype", () => Function.prototype, true], ["parseInt", () => parseInt, true], ["String", () => String, true],
  ["a bound function", () => bound, true], ["a bound arrow function", () => boundArrow, true], ["a bound native function", () => boundNative, true], ["a bound class", () => boundClass, true], ["a bound function of the text", () => boundInText, true], ["a function bound twice", () => boundTwice, true],
  ["a proxy of an arrow function", () => proxyOfArrow, true], ["a proxy of a function that is constructed", () => proxyOfConstructed, true], ["a proxy of a class", () => proxyOfClass, true], ["a proxy of a native function", () => proxyOfNative, true],
  ["a proxy of a function of the text", () => proxyOfInText, true], ["a proxy that traps calls", () => trapping, true], ["a revoked proxy", () => revocable.proxy, true],
];

const isSame = (o, left, right) => agree([o.same(left(), right()), !o.different(left(), right()), o.ifSame(left(), right()), !o.ifDifferent(left(), right()), o.whileSame(left(), right()), !o.whileDifferent(left(), right())]);
const mark = answer => (answer === true ? "=" : answer === false ? "." : "?");

function equalityRows(o) {
  return operands.map(([name, left], index) => {
    const value = left();
    return index + " " + name + " ===: " + operands.map(([, right]) => mark(isSame(o, left, right))).join("") + " itself " + mark(isSame(o, () => value, () => value));
  });
}

const kinds = [atom, fresh, fromCodes, parsed, wide, rope, sliced];
function equalLengthRows(o) {
  const rows = [];
  for (const length of [1, 2, 3, 8, 16, 31, 32, 33, 36]) {
    const whole = source.letters.slice(0, length), middle = length >> 1;
    const others = { equal: whole, first: "#" + whole.slice(1), middle: whole.slice(0, middle) + "#" + whole.slice(middle + 1), last: whole.slice(0, -1) + "#" };
    for (const [change, other] of Object.entries(others)) {
      rows.push(length + " letters, " + change + ": " + kinds.map(left => kinds.map(right => mark(isSame(o, () => left(whole), () => right(other)))).join("")).join(" "));
    }
  }
  return rows;
}

function sumRows(o) {
  return operands.map(([name, left, leftIsOpaque], index) => {
    const sums = operands.map(([, right, rightIsOpaque]) => {
      const tell = leftIsOpaque || rightIsOpaque ? brief : attempt;
      return agree([tell(() => o.sum(left(), right())), tell(() => o.append(left(), right()))]);
    });
    return index + " " + name + " +: " + sums.join(" ");
  });
}

function unaryRows(o) {
  return operands.map(([name, make], index) =>
    [
      index + " " + name + ":",
      o.typeOf(make()),
      "function " + agree([o.isFunction(make()), !o.isNoFunction(make()), o.ifFunction(make())]),
      "object " + agree([o.isObject(make()), !o.isNoObject(make()), o.ifObject(make())]),
      "truthy " + agree([o.ifTruthy(make()), !o.ifFalsy(make()), o.whileTruthy(make()), o.choose(make()) === 1]),
      "and " + describe(o.and(make(), "right")),
      "or " + describe(o.or(make(), "right")),
      "length " + attempt(() => o.lengthOf(make())),
    ].join(" "),
  );
}

function callRows(o) {
  const rows = [];
  for (let round = 0; round < 3; round++) rows.push("called: " + operands.map(([, make]) => complete(() => o.call(make(), "arg"))).join(" | "));
  rows.push("a generator: " + [...o.call(generator, "first")].join());
  return rows;
}

const tables = o => [...equalityRows(o), ...equalLengthRows(o), ...sumRows(o), ...unaryRows(o), ...callRows(o)];
const expected = tables(narrow);
lines.push(...expected);
for (const [width, o] of widths.slice(1)) {
  const differing = tables(o).filter((row, index) => row !== expected[index]);
  lines.push(width + ": " + (differing.length ? "not as narrow\n" + differing.join("\n") : "as narrow"));
}

// Only the jsc shell can make one, so what it must answer is written down here.
const masquerader = typeof makeMasquerader === "function" ? makeMasquerader() : null;
const surprises = [];
if (masquerader !== null) {
  for (const [width, o] of widths) {
    const checks = [
      ["=== itself", isSame(o, () => masquerader, () => masquerader) === true],
      ["=== undefined", isSame(o, () => masquerader, () => undefined) === false && isSame(o, () => null, () => masquerader) === false],
      ["typeof", o.typeOf(masquerader) === "undefined" && !o.isFunction(masquerader) && o.isNoFunction(masquerader) && !o.ifFunction(masquerader) && !o.isObject(masquerader) && o.isNoObject(masquerader) && !o.ifObject(masquerader)],
      ["conditions", !o.ifTruthy(masquerader) && o.ifFalsy(masquerader) && !o.whileTruthy(masquerader) && o.choose(masquerader) === 2 && o.or(masquerader, "right") === "right" && o.and(masquerader, "right") === masquerader],
      ["length", o.lengthOf(masquerader) === 0],
      ["+", typeof o.sum(masquerader, "") === "string"],
    ];
    for (const [name, holds] of checks) if (!holds) surprises.push(width + " " + name);
  }
}
lines.push("what masquerades as undefined: " + (surprises.length ? surprises.join() : "as it should"));

const table = { GET: "found", "中文": "found too" };
lines.push("ropes as keys: " + table[sumInText(source.g, source.et)] + " " + table[sumInText(source.left, source.right)] + " " + (sumInText(source.g, source.et) in table) + " " + (sumInText(source.et, source.g) in table));

const kept = [];
let checksum = 0;
for (let turn = 0; turn < 100000; turn++) {
  const joined = sumInText(sumInText("key" + (turn % 7), ":"), turn % 2 ? "value" : "値");
  checksum = (checksum + narrow.lengthOf(joined) + joined.charCodeAt(joined.length - 1)) % 1000003;
  if (turn % 5000 === 0) kept.push(sumInText(sumInText("kept" + turn, turn % 10000 ? "-" : "—"), source.letters));
  if (turn % 25000 === 24999) collect();
}
collect();
lines.push("ropes: " + checksum + " " + kept.join(" "));

let deep = "";
for (let turn = 0; turn < 20000; turn++) deep = turn % 2 ? sumInText(deep, "r") : sumInText("l", deep);
lines.push("a deep rope: " + describe(deep) + " " + deep.indexOf("lr"));

for (const [width, o] of widths) {
  const powers = ["x"];
  for (let k = 1; k <= 30; k++) powers.push(o.sum(powers[k - 1], powers[k - 1]));
  let almost = powers[0];
  for (let k = 1; k <= 29; k++) almost = o.sum(almost, powers[k]);
  const longest = o.sum(powers[30], almost);
  lines.push(width + ", the longest string: " + [() => o.lengthOf(longest), () => o.ifTruthy(longest), () => o.lengthOf(o.sum(longest, "")), () => o.lengthOf(o.sum("", longest)), () => o.lengthOf(o.sum(longest, "x")), () => o.lengthOf(o.sum("x", longest)), () => o.lengthOf(o.sum(powers[30], powers[30])), () => o.lengthOf(o.sum(longest, longest))].map(attempt).join(" "));
}

const callees = [arrow, withProperties, declared, fewer, more, rest, defaults, Legacy, Constructed, Base.prototype.method, Base.make, bound, boundArrow, boundTwice, inText, String];
let total = 0;
for (let turn = 0; turn < 60000; turn++) {
  total += narrow.call(callees[turn % callees.length], turn).length;
  if (turn % 100 === 0) total += narrow.call((a, b) => "closure of turn " + turn + " " + a + b, turn).length;
  if (turn % 20000 === 19999) collect();
}
lines.push("calls: " + total);

narrow.call(later, "awaited").then(value => {
  lines.push("an async function: " + value);
  console.log(lines.join("\n"));
});
