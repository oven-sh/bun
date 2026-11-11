const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isNumber(x) { return x instanceof Number; }
function countNumber(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Number) count++; } return count; }
function isString(x) { return x instanceof String; }
function countString(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof String) count++; } return count; }
function isBoolean(x) { return x instanceof Boolean; }
function countBoolean(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Boolean) count++; } return count; }
function isDate(x) { return x instanceof Date; }
function countDate(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Date) count++; } return count; }
function isRegExp(x) { return x instanceof RegExp; }
function countRegExp(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof RegExp) count++; } return count; }
function isSymbol(x) { return x instanceof Symbol; }
function countSymbol(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Symbol) count++; } return count; }
function isBigInt(x) { return x instanceof BigInt; }
function countBigInt(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof BigInt) count++; } return count; }
function isObject(x) { return x instanceof Object; }
function countObject(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Object) count++; } return count; }
const tests = [["Number", isNumber, countNumber], ["String", isString, countString], ["Boolean", isBoolean, countBoolean], ["Date", isDate, countDate], ["RegExp", isRegExp, countRegExp], ["Symbol", isSymbol, countSymbol], ["BigInt", isBigInt, countBigInt], ["Object", isObject, countObject]];
const values = [];
maybe("created below Number.prototype", () => Object.create(Number.prototype), values);
maybe("Number.prototype", () => Number.prototype, values);
maybe("Number", () => Number, values);
maybe("new Number", () => new Number(1), values);
maybe("new of a class below Number", () => new (class extends Number {})(1), values);
maybe("new Number without its prototype", () => Object.setPrototypeOf(new Number(1), null), values);
maybe("new Number below String.prototype", () => Object.setPrototypeOf(new Number(1), String.prototype), values);
maybe("a proxy of new Number", () => new Proxy(new Number(1), {}), values);
maybe("Number made for String as new.target", () => Reflect.construct(Number, [1], String), values);
maybe("created below String.prototype", () => Object.create(String.prototype), values);
maybe("String.prototype", () => String.prototype, values);
maybe("String", () => String, values);
maybe("new String", () => new String("a"), values);
maybe("new of a class below String", () => new (class extends String {})("a"), values);
maybe("new String without its prototype", () => Object.setPrototypeOf(new String("a"), null), values);
maybe("new String below Boolean.prototype", () => Object.setPrototypeOf(new String("a"), Boolean.prototype), values);
maybe("a proxy of new String", () => new Proxy(new String("a"), {}), values);
maybe("String made for Boolean as new.target", () => Reflect.construct(String, ["a"], Boolean), values);
maybe("created below Boolean.prototype", () => Object.create(Boolean.prototype), values);
maybe("Boolean.prototype", () => Boolean.prototype, values);
maybe("Boolean", () => Boolean, values);
maybe("new Boolean", () => new Boolean(true), values);
maybe("new of a class below Boolean", () => new (class extends Boolean {})(true), values);
maybe("new Boolean without its prototype", () => Object.setPrototypeOf(new Boolean(true), null), values);
maybe("new Boolean below Date.prototype", () => Object.setPrototypeOf(new Boolean(true), Date.prototype), values);
maybe("a proxy of new Boolean", () => new Proxy(new Boolean(true), {}), values);
maybe("Boolean made for Date as new.target", () => Reflect.construct(Boolean, [true], Date), values);
maybe("created below Date.prototype", () => Object.create(Date.prototype), values);
maybe("Date.prototype", () => Date.prototype, values);
maybe("Date", () => Date, values);
maybe("new Date", () => new Date(0), values);
maybe("new of a class below Date", () => new (class extends Date {})(0), values);
maybe("new Date without its prototype", () => Object.setPrototypeOf(new Date(0), null), values);
maybe("new Date below RegExp.prototype", () => Object.setPrototypeOf(new Date(0), RegExp.prototype), values);
maybe("a proxy of new Date", () => new Proxy(new Date(0), {}), values);
maybe("Date made for RegExp as new.target", () => Reflect.construct(Date, [0], RegExp), values);
maybe("created below RegExp.prototype", () => Object.create(RegExp.prototype), values);
maybe("RegExp.prototype", () => RegExp.prototype, values);
maybe("RegExp", () => RegExp, values);
maybe("new RegExp", () => new RegExp("a"), values);
maybe("new of a class below RegExp", () => new (class extends RegExp {})("a"), values);
maybe("new RegExp without its prototype", () => Object.setPrototypeOf(new RegExp("a"), null), values);
maybe("new RegExp below Symbol.prototype", () => Object.setPrototypeOf(new RegExp("a"), Symbol.prototype), values);
maybe("a proxy of new RegExp", () => new Proxy(new RegExp("a"), {}), values);
maybe("RegExp made for Symbol as new.target", () => Reflect.construct(RegExp, ["a"], Symbol), values);
maybe("created below Symbol.prototype", () => Object.create(Symbol.prototype), values);
maybe("Symbol.prototype", () => Symbol.prototype, values);
maybe("Symbol", () => Symbol, values);
maybe("created below BigInt.prototype", () => Object.create(BigInt.prototype), values);
maybe("BigInt.prototype", () => BigInt.prototype, values);
maybe("BigInt", () => BigInt, values);
maybe("created below Object.prototype", () => Object.create(Object.prototype), values);
maybe("Object.prototype", () => Object.prototype, values);
maybe("Object", () => Object, values);
maybe("new Object", () => new Object(), values);
maybe("new of a class below Object", () => new (class extends Object {})(), values);
maybe("new Object without its prototype", () => Object.setPrototypeOf(new Object(), null), values);
maybe("new Object below Number.prototype", () => Object.setPrototypeOf(new Object(), Number.prototype), values);
maybe("a proxy of new Object", () => new Proxy(new Object(), {}), values);
maybe("Object made for Number as new.target", () => Reflect.construct(Object, [], Number), values);
maybe("1", () => (1), values);
maybe(`"a"`, () => ("a"), values);
maybe("true", () => (true), values);
maybe("1n", () => (1n), values);
maybe("Symbol.iterator", () => (Symbol.iterator), values);
maybe("Object(1)", () => (Object(1)), values);
maybe(`Object("a")`, () => (Object("a")), values);
maybe("Object(true)", () => (Object(true)), values);
maybe("Object(1n)", () => (Object(1n)), values);
maybe("Object(Symbol.iterator)", () => (Object(Symbol.iterator)), values);
maybe("/a/", () => (/a/), values);
maybe("Number(1)", () => (Number(1)), values);
maybe(`String("a")`, () => (String("a")), values);
maybe("Date()", () => (Date()), values);
maybe(`RegExp("a")`, () => (RegExp("a")), values);
maybe("RegExp(/a/)", () => (RegExp(/a/)), values);
maybe("new RegExp(/a/)", () => (new RegExp(/a/)), values);
maybe("Number.prototype", () => (Number.prototype), values);
maybe("String.prototype", () => (String.prototype), values);
maybe("Boolean.prototype", () => (Boolean.prototype), values);
maybe("Date.prototype", () => (Date.prototype), values);
maybe("RegExp.prototype", () => (RegExp.prototype), values);
maybe("Symbol.prototype", () => (Symbol.prototype), values);
maybe("BigInt.prototype", () => (BigInt.prototype), values);
maybe("null", () => (null), values);
maybe("undefined", () => (undefined), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Number: " + (Number[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Number, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Number, value))) + show(attempt(() => Number[Symbol.hasInstance](value)))).join(""));
report("String: " + (String[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(String, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(String, value))) + show(attempt(() => String[Symbol.hasInstance](value)))).join(""));
report("Boolean: " + (Boolean[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Boolean, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Boolean, value))) + show(attempt(() => Boolean[Symbol.hasInstance](value)))).join(""));
report("Date: " + (Date[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Date, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Date, value))) + show(attempt(() => Date[Symbol.hasInstance](value)))).join(""));
report("RegExp: " + (RegExp[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(RegExp, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(RegExp, value))) + show(attempt(() => RegExp[Symbol.hasInstance](value)))).join(""));
report("Symbol: " + (Symbol[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Symbol, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Symbol, value))) + show(attempt(() => Symbol[Symbol.hasInstance](value)))).join(""));
report("BigInt: " + (BigInt[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(BigInt, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(BigInt, value))) + show(attempt(() => BigInt[Symbol.hasInstance](value)))).join(""));
report("Object: " + (Object[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Object, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Object, value))) + show(attempt(() => Object[Symbol.hasInstance](value)))).join(""));
process.exit(0);
