const report = value => console.log(typeof value === "string" ? value : String(value));
// Generated: classes that share a prototype object, a kind of cell or a row of classes, each asked about the values of all.
const show = (value) => value === true ? "1" : value === false ? "0" : String(value);
function attempt(act) { try { return act(); } catch (error) { return "T"; } }
function maybe(name, make, values) { try { values.push([name, make()]); } catch (error) { values.push([name + ", which cannot be made: " + error.name, undefined]); } }

function isError(x) { return x instanceof Error; }
function countError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof Error) count++; } return count; }
function isTypeError(x) { return x instanceof TypeError; }
function countTypeError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof TypeError) count++; } return count; }
function isRangeError(x) { return x instanceof RangeError; }
function countRangeError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof RangeError) count++; } return count; }
function isSyntaxError(x) { return x instanceof SyntaxError; }
function countSyntaxError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof SyntaxError) count++; } return count; }
function isReferenceError(x) { return x instanceof ReferenceError; }
function countReferenceError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof ReferenceError) count++; } return count; }
function isEvalError(x) { return x instanceof EvalError; }
function countEvalError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof EvalError) count++; } return count; }
function isURIError(x) { return x instanceof URIError; }
function countURIError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof URIError) count++; } return count; }
function isAggregateError(x) { return x instanceof AggregateError; }
function countAggregateError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof AggregateError) count++; } return count; }
function isSuppressedError(x) { return x instanceof SuppressedError; }
function countSuppressedError(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof SuppressedError) count++; } return count; }
function isDOMException(x) { return x instanceof DOMException; }
function countDOMException(x) { let count = 0; for (let turn = 0; turn < 3; turn++) { if (x instanceof DOMException) count++; } return count; }
const tests = [["Error", isError, countError], ["TypeError", isTypeError, countTypeError], ["RangeError", isRangeError, countRangeError], ["SyntaxError", isSyntaxError, countSyntaxError], ["ReferenceError", isReferenceError, countReferenceError], ["EvalError", isEvalError, countEvalError], ["URIError", isURIError, countURIError], ["AggregateError", isAggregateError, countAggregateError], ["SuppressedError", isSuppressedError, countSuppressedError], ["DOMException", isDOMException, countDOMException]];
const values = [];
maybe("created below Error.prototype", () => Object.create(Error.prototype), values);
maybe("Error.prototype", () => Error.prototype, values);
maybe("Error", () => Error, values);
maybe("new Error", () => new Error("a"), values);
maybe("new of a class below Error", () => new (class extends Error {})("a"), values);
maybe("new Error without its prototype", () => Object.setPrototypeOf(new Error("a"), null), values);
maybe("new Error below TypeError.prototype", () => Object.setPrototypeOf(new Error("a"), TypeError.prototype), values);
maybe("a proxy of new Error", () => new Proxy(new Error("a"), {}), values);
maybe("Error made for TypeError as new.target", () => Reflect.construct(Error, ["a"], TypeError), values);
maybe("created below TypeError.prototype", () => Object.create(TypeError.prototype), values);
maybe("TypeError.prototype", () => TypeError.prototype, values);
maybe("TypeError", () => TypeError, values);
maybe("new TypeError", () => new TypeError("a"), values);
maybe("new of a class below TypeError", () => new (class extends TypeError {})("a"), values);
maybe("new TypeError without its prototype", () => Object.setPrototypeOf(new TypeError("a"), null), values);
maybe("new TypeError below RangeError.prototype", () => Object.setPrototypeOf(new TypeError("a"), RangeError.prototype), values);
maybe("a proxy of new TypeError", () => new Proxy(new TypeError("a"), {}), values);
maybe("TypeError made for RangeError as new.target", () => Reflect.construct(TypeError, ["a"], RangeError), values);
maybe("created below RangeError.prototype", () => Object.create(RangeError.prototype), values);
maybe("RangeError.prototype", () => RangeError.prototype, values);
maybe("RangeError", () => RangeError, values);
maybe("new RangeError", () => new RangeError("a"), values);
maybe("new of a class below RangeError", () => new (class extends RangeError {})("a"), values);
maybe("new RangeError without its prototype", () => Object.setPrototypeOf(new RangeError("a"), null), values);
maybe("new RangeError below SyntaxError.prototype", () => Object.setPrototypeOf(new RangeError("a"), SyntaxError.prototype), values);
maybe("a proxy of new RangeError", () => new Proxy(new RangeError("a"), {}), values);
maybe("RangeError made for SyntaxError as new.target", () => Reflect.construct(RangeError, ["a"], SyntaxError), values);
maybe("created below SyntaxError.prototype", () => Object.create(SyntaxError.prototype), values);
maybe("SyntaxError.prototype", () => SyntaxError.prototype, values);
maybe("SyntaxError", () => SyntaxError, values);
maybe("new SyntaxError", () => new SyntaxError("a"), values);
maybe("new of a class below SyntaxError", () => new (class extends SyntaxError {})("a"), values);
maybe("new SyntaxError without its prototype", () => Object.setPrototypeOf(new SyntaxError("a"), null), values);
maybe("new SyntaxError below ReferenceError.prototype", () => Object.setPrototypeOf(new SyntaxError("a"), ReferenceError.prototype), values);
maybe("a proxy of new SyntaxError", () => new Proxy(new SyntaxError("a"), {}), values);
maybe("SyntaxError made for ReferenceError as new.target", () => Reflect.construct(SyntaxError, ["a"], ReferenceError), values);
maybe("created below ReferenceError.prototype", () => Object.create(ReferenceError.prototype), values);
maybe("ReferenceError.prototype", () => ReferenceError.prototype, values);
maybe("ReferenceError", () => ReferenceError, values);
maybe("new ReferenceError", () => new ReferenceError("a"), values);
maybe("new of a class below ReferenceError", () => new (class extends ReferenceError {})("a"), values);
maybe("new ReferenceError without its prototype", () => Object.setPrototypeOf(new ReferenceError("a"), null), values);
maybe("new ReferenceError below EvalError.prototype", () => Object.setPrototypeOf(new ReferenceError("a"), EvalError.prototype), values);
maybe("a proxy of new ReferenceError", () => new Proxy(new ReferenceError("a"), {}), values);
maybe("ReferenceError made for EvalError as new.target", () => Reflect.construct(ReferenceError, ["a"], EvalError), values);
maybe("created below EvalError.prototype", () => Object.create(EvalError.prototype), values);
maybe("EvalError.prototype", () => EvalError.prototype, values);
maybe("EvalError", () => EvalError, values);
maybe("new EvalError", () => new EvalError("a"), values);
maybe("new of a class below EvalError", () => new (class extends EvalError {})("a"), values);
maybe("new EvalError without its prototype", () => Object.setPrototypeOf(new EvalError("a"), null), values);
maybe("new EvalError below URIError.prototype", () => Object.setPrototypeOf(new EvalError("a"), URIError.prototype), values);
maybe("a proxy of new EvalError", () => new Proxy(new EvalError("a"), {}), values);
maybe("EvalError made for URIError as new.target", () => Reflect.construct(EvalError, ["a"], URIError), values);
maybe("created below URIError.prototype", () => Object.create(URIError.prototype), values);
maybe("URIError.prototype", () => URIError.prototype, values);
maybe("URIError", () => URIError, values);
maybe("new URIError", () => new URIError("a"), values);
maybe("new of a class below URIError", () => new (class extends URIError {})("a"), values);
maybe("new URIError without its prototype", () => Object.setPrototypeOf(new URIError("a"), null), values);
maybe("new URIError below AggregateError.prototype", () => Object.setPrototypeOf(new URIError("a"), AggregateError.prototype), values);
maybe("a proxy of new URIError", () => new Proxy(new URIError("a"), {}), values);
maybe("URIError made for AggregateError as new.target", () => Reflect.construct(URIError, ["a"], AggregateError), values);
maybe("created below AggregateError.prototype", () => Object.create(AggregateError.prototype), values);
maybe("AggregateError.prototype", () => AggregateError.prototype, values);
maybe("AggregateError", () => AggregateError, values);
maybe("new AggregateError", () => new AggregateError([], "a"), values);
maybe("new of a class below AggregateError", () => new (class extends AggregateError {})([], "a"), values);
maybe("new AggregateError without its prototype", () => Object.setPrototypeOf(new AggregateError([], "a"), null), values);
maybe("new AggregateError below SuppressedError.prototype", () => Object.setPrototypeOf(new AggregateError([], "a"), SuppressedError.prototype), values);
maybe("a proxy of new AggregateError", () => new Proxy(new AggregateError([], "a"), {}), values);
maybe("AggregateError made for SuppressedError as new.target", () => Reflect.construct(AggregateError, [[], "a"], SuppressedError), values);
maybe("created below SuppressedError.prototype", () => Object.create(SuppressedError.prototype), values);
maybe("SuppressedError.prototype", () => SuppressedError.prototype, values);
maybe("SuppressedError", () => SuppressedError, values);
maybe("new SuppressedError", () => new SuppressedError(1, 2, "a"), values);
maybe("new of a class below SuppressedError", () => new (class extends SuppressedError {})(1, 2, "a"), values);
maybe("new SuppressedError without its prototype", () => Object.setPrototypeOf(new SuppressedError(1, 2, "a"), null), values);
maybe("new SuppressedError below DOMException.prototype", () => Object.setPrototypeOf(new SuppressedError(1, 2, "a"), DOMException.prototype), values);
maybe("a proxy of new SuppressedError", () => new Proxy(new SuppressedError(1, 2, "a"), {}), values);
maybe("SuppressedError made for DOMException as new.target", () => Reflect.construct(SuppressedError, [1, 2, "a"], DOMException), values);
maybe("created below DOMException.prototype", () => Object.create(DOMException.prototype), values);
maybe("DOMException.prototype", () => DOMException.prototype, values);
maybe("DOMException", () => DOMException, values);
maybe("new DOMException", () => new DOMException("a", "AbortError"), values);
maybe("new of a class below DOMException", () => new (class extends DOMException {})("a", "AbortError"), values);
maybe("new DOMException without its prototype", () => Object.setPrototypeOf(new DOMException("a", "AbortError"), null), values);
maybe("new DOMException below Error.prototype", () => Object.setPrototypeOf(new DOMException("a", "AbortError"), Error.prototype), values);
maybe("a proxy of new DOMException", () => new Proxy(new DOMException("a", "AbortError"), {}), values);
maybe("DOMException made for Error as new.target", () => Reflect.construct(DOMException, ["a", "AbortError"], Error), values);
maybe("(() => { try { null.a; } catch (error) { return error; } })()", () => ((() => { try { null.a; } catch (error) { return error; } })()), values);
maybe("(() => { try { new Array(-1); } catch (error) { return error; } })()", () => ((() => { try { new Array(-1); } catch (error) { return error; } })()), values);
maybe(`(() => { try { JSON.parse("{"); } catch (error) { return error; } })()`, () => ((() => { try { JSON.parse("{"); } catch (error) { return error; } })()), values);
maybe("(() => { try { missing; } catch (error) { return error; } })()", () => ((() => { try { missing; } catch (error) { return error; } })()), values);
maybe(`(() => { try { decodeURI("%"); } catch (error) { return error; } })()`, () => ((() => { try { decodeURI("%"); } catch (error) { return error; } })()), values);
maybe(`structuredClone(new RangeError("a"))`, () => (structuredClone(new RangeError("a"))), values);
maybe("AbortSignal.abort().reason", () => (AbortSignal.abort().reason), values);
maybe("AbortSignal.timeout(0)", () => (AbortSignal.timeout(0)), values);
maybe(`Error("a")`, () => (Error("a")), values);
maybe(`TypeError("a")`, () => (TypeError("a")), values);
maybe(`{ name: "Error", message: "a", stack: "" }`, () => ({ name: "Error", message: "a", stack: "" }), values);
for (const [name, value] of values) {
  let answers = "";
  for (const [, is, count] of tests) answers += show(attempt(() => is(value))) + show(attempt(() => count(value)));
  report(answers + " " + name);
}
const ordinary = Function.prototype[Symbol.hasInstance];
report("Error: " + (Error[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(Error, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(Error, value))) + show(attempt(() => Error[Symbol.hasInstance](value)))).join(""));
report("TypeError: " + (TypeError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(TypeError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(TypeError, value))) + show(attempt(() => TypeError[Symbol.hasInstance](value)))).join(""));
report("RangeError: " + (RangeError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(RangeError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(RangeError, value))) + show(attempt(() => RangeError[Symbol.hasInstance](value)))).join(""));
report("SyntaxError: " + (SyntaxError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(SyntaxError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(SyntaxError, value))) + show(attempt(() => SyntaxError[Symbol.hasInstance](value)))).join(""));
report("ReferenceError: " + (ReferenceError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(ReferenceError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(ReferenceError, value))) + show(attempt(() => ReferenceError[Symbol.hasInstance](value)))).join(""));
report("EvalError: " + (EvalError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(EvalError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(EvalError, value))) + show(attempt(() => EvalError[Symbol.hasInstance](value)))).join(""));
report("URIError: " + (URIError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(URIError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(URIError, value))) + show(attempt(() => URIError[Symbol.hasInstance](value)))).join(""));
report("AggregateError: " + (AggregateError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(AggregateError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(AggregateError, value))) + show(attempt(() => AggregateError[Symbol.hasInstance](value)))).join(""));
report("SuppressedError: " + (SuppressedError[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(SuppressedError, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(SuppressedError, value))) + show(attempt(() => SuppressedError[Symbol.hasInstance](value)))).join(""));
report("DOMException: " + (DOMException[Symbol.hasInstance] === ordinary) + " " + Object.hasOwn(DOMException, Symbol.hasInstance) + " " + values.map(([, value]) => show(attempt(() => ordinary.call(DOMException, value))) + show(attempt(() => DOMException[Symbol.hasInstance](value)))).join(""));
process.exit(0);
