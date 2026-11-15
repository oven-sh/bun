// Programs of native-callbacks, members-*.js. `bun test/aot/generate.ts native-callbacks <where>` writes them.
// What native code reads under a NAME or a SYMBOL of an object it is handed: the fields of a descriptor, the traps of a handler, the protocols of String.prototype, conversions, toJSON, cause, the methods of a stream's source,
// handleEvent, the members of an options object. ONE BUILT-IN, ONE MEMBER AND ONE FORM A PROGRAM. The forms: the object's own member (the control), inherited from a plain object, from two above, an inherited getter, an own getter,
// the prototype object of a class. For a setter: own, inherited, from two above, of a class. What is handed through is an instance whose method `double` nothing else reaches. No stored outputs: plain Bun is the reference.
import { programsOf, type WrittenProgram } from "../generate";

/** By the path below the folder of programs. */
const filesWritten: Record<string, string> = {};

const ITEM = `class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
`;

function pad(text: string, indent: string) {
  return text.replace(/\n+$/, "").split("\n").map(line => line ? indent + line + "\n" : "\n").join("");
}
// The member as it is written in a literal or in a class.
function member(key: string, kind: any, indent: string) {
  if (kind[0] === "data") {
    return indent + key + ": " + kind[1] + ",\n";
  }
  const head = { method: key, setter: "set " + key }[kind[0]];
  return indent + head + "(" + kind[1] + ") {\n" + pad(kind[2], indent + "  ") + indent + "},\n";
}
function getter(key: string, name: string, kind: any, indent: string, end = ",") {
  const answer = kind[0] === "data" ? kind[1] : "function (" + kind[1] + ") {\n" + pad(kind[2], indent + "    ") + indent + "  }";
  return indent + "get " + key + "() {\n" + indent + '  log.push("get ' + name + ' " + (this === holder));\n' + indent + "  return " + answer + ";\n" + indent + "}" + end + "\n";
}
function own(pairs: any, indent: string) {
  return pairs.map(([k, v]) => indent + k + ": " + v + ",\n").join("");
}
function inClass(key: string, kind: any, pairs: any) {
  const fields = pairs.map(([k, v]) => "  " + k + " = " + v + ";\n").join("");
  if (kind[0] === "data") {
    const at = key.startsWith("[") ? key : "." + key;
    return fields ? "class Holder {\n" + fields + "}\nHolder.prototype" + at + " = " + kind[1] + ";\nconst holder = new Holder();\n" : "class Holder {}\nHolder.prototype" + at + " = " + kind[1] + ";\nconst holder = new Holder();\n";
  }
  return "class Holder {\n" + fields + member(key, kind, "  ").replace(/[,\n]+$/, "") + "\n}\nconst holder = new Holder();\n";
}
const FORMS: Record<string, [string, (k: any, n: any, m: any, o: any) => string]> = {
  "its-own": ["it is the object's own", (k, n, m, o) => "const holder = {\n" + member(k, m, "  ") + own(o, "  ") + "};\n"],
  "inherited-from-a-plain-object": ["the object inherits it from a plain object", (k, n, m, o) => "const holder = {\n  __proto__: {\n" + member(k, m, "    ") + "  },\n" + own(o, "  ") + "};\n"],
  "inherited-from-two-objects-above": ["the object inherits it from the plain object two above", (k, n, m, o) => "const holder = {\n  __proto__: {\n    __proto__: {\n" + member(k, m, "      ") + "    },\n  },\n" + own(o, "  ") + "};\n"],
  "by-an-inherited-getter": ["the plain object above has a getter under that name", (k, n, m, o) => "const holder = {\n  __proto__: {\n" + getter(k, n, m, "    ") + "  },\n" + own(o, "  ") + "};\n"],
  "by-its-own-getter": ["the object has a getter under that name", (k, n, m, o) => "const holder = {\n" + getter(k, n, m, "  ") + own(o, "  ") + "};\n"],
  "of-a-class": ["the object is an instance of a class whose prototype object has it", (k, n, m, o) => inClass(k, m, o)],
};

const SEEN = 'log.push("%s " + (this === holder) + " " + arguments.length);';
const D: [string, string][] = [["configurable", "true"], ["enumerable", "true"]];
const T = "const target = { x: item };\n";
function trap(name: string, parameters: string, answer: string, use: string, show: string, pre = T) {
  return ["proxy", "A proxy", name, name, ["method", parameters, SEEN.replace("%s", name) + "\nreturn " + answer + ";"], [], use, show, pre];
}
function convert(builtin: string, text: string, key: string, name: string, answer: string, use: string, show = "result") {
  return [builtin, text, key, name, ["method", "hint", 'log.push("' + name + ' " + (this === holder) + " " + typeof hint);\nreturn ' + answer + ";"], [], use, show, ""];
}
// (built-in, how the text names it, the key as written, the key as said, the member, the object's other own members, the call, what is shown, what stands in front)
const ROWS = <[string, string, string, string, string[], string[][], string, string, string][]>[...[
  ["object-define-property", "Object.defineProperty", "value", "value", ["data", "item"], D, 'Object.defineProperty({}, "x", holder)', "result.x.double()", ""],
  ["object-define-property", "Object.defineProperty", "get", "get", ["method", "", 'log.push("runs get " + (this === target) + " " + arguments.length);\nreturn item;'], D, 'Object.defineProperty(target, "x", holder)', "result.x.double()", "const target = {};\n"],
  ["object-define-property", "Object.defineProperty", "set", "set", ["method", "value", 'log.push("runs set " + (this === target) + " " + typeof value);\nkept.push(value);'], D, 'Object.defineProperty(target, "x", holder)', "(result.x = item) === item, kept[0].double()", "const target = {};\n"],
  ["object-define-properties", "Object.defineProperties", "value", "value", ["data", "item"], D, "Object.defineProperties({}, { x: holder })", "result.x.double()", ""],
  ["object-define-properties", "Object.defineProperties", "get", "get", ["method", "", 'log.push("runs get " + arguments.length);\nreturn item;'], D, "Object.defineProperties({}, { x: holder })", "result.x.double()", ""],
  ["object-create", "Object.create", "value", "value", ["data", "item"], D, "Object.create(null, { x: holder })", "result.x.double()", ""],
  ["object-create", "Object.create", "get", "get", ["method", "", 'log.push("runs get " + arguments.length);\nreturn item;'], D, "Object.create(null, { x: holder })", "result.x.double()", ""],
  ["reflect-define-property", "Reflect.defineProperty", "value", "value", ["data", "item"], D, 'Reflect.defineProperty(target, "x", holder)', "result, target.x.double()", "const target = {};\n"],
  ["reflect-define-property", "Reflect.defineProperty", "get", "get", ["method", "", 'log.push("runs get " + (this === target));\nreturn item;'], D, 'Reflect.defineProperty(target, "x", holder)', "result, target.x.double()", "const target = {};\n"],
  ["the-descriptor-a-proxy-answers-with", "Object.getOwnPropertyDescriptor of a proxy, whose trap answers with the object,", "value", "value", ["data", "item"], D, 'Object.getOwnPropertyDescriptor(new Proxy({}, { getOwnPropertyDescriptor: () => holder }), "x")', "result.value.double()", ""],
  trap("get", "target, key, receiver", "target[key]", "new Proxy(target, holder).x", "result.double()"),
  trap("set", "target, key, value", "Reflect.set(target, key, value)", "(new Proxy(target, holder).y = item)", "target.y.double()"),
  trap("has", "target, key", "key in target", '"x" in new Proxy(target, holder)', "result"),
  trap("deleteProperty", "target, key", "delete target[key]", "delete new Proxy(target, holder).x", 'result, "x" in target'),
  trap("ownKeys", "target", "Reflect.ownKeys(target)", "Object.keys(new Proxy(target, holder))", "result.join()"),
  trap("getOwnPropertyDescriptor", "target, key", "Reflect.getOwnPropertyDescriptor(target, key)", 'Object.getOwnPropertyDescriptor(new Proxy(target, holder), "x")', "result.value.double()"),
  trap("defineProperty", "target, key, descriptor", "Reflect.defineProperty(target, key, descriptor)", 'Object.defineProperty(new Proxy(target, holder), "z", { value: item, configurable: true })', "target.z.double()"),
  trap("getPrototypeOf", "target", "Item.prototype", "Object.getPrototypeOf(new Proxy(target, holder))", "result.double.call(item)"),
  trap("setPrototypeOf", "target, prototype", "Reflect.setPrototypeOf(target, prototype)", "Object.setPrototypeOf(new Proxy(target, holder), Item.prototype)", "target.double.call(item)"),
  trap("isExtensible", "target", "Reflect.isExtensible(target)", "Object.isExtensible(new Proxy(target, holder))", "result"),
  trap("preventExtensions", "target", "Reflect.preventExtensions(target)", "Object.preventExtensions(new Proxy(target, holder))", "Object.isExtensible(target)"),
  trap("apply", "target, receiver, list", "list[0]", "new Proxy(target, holder)(item)", "result.double()", "function target() {}\n"),
  trap("construct", "target, list, newTarget", "{ held: list[0] }", "new (new Proxy(target, holder))(item)", "result.held.double()", "function target() {}\n"),
], ...[["replace", "replace", "replace", ', "x"'], ["replace-all", "replaceAll", "replace", ', "x"'], ["split", "split", "split", ""], ["match", "match", "match", ""], ["match-all", "matchAll", "matchAll", ""], ["search", "search", "search", ""]].map(([name, method, symbol, more]) => ["string-" + name, "String.prototype." + method, "[Symbol." + symbol + "]", "Symbol." + symbol, ["method", "text, more", 'log.push("' + symbol + ' " + (this === holder) + " " + typeof text + " " + typeof more);\nreturn item;'], [], '"text".' + method + "(holder" + more + ")", "result.double()", ""]), ...[
  convert("number", "Number(..)", "valueOf", "valueOf", "7", "Number(holder)", "result + 1"),
  convert("string", "String(..)", "toString", "toString", '"text"', "String(holder)", "result + 1"),
  convert("date", "new Date(..)", "[Symbol.toPrimitive]", "Symbol.toPrimitive", "5", "new Date(holder).getTime()"),
  convert("math-abs", "Math.abs", "valueOf", "valueOf", "-7", "Math.abs(holder)"),
  convert("parse-int", "parseInt", "toString", "toString", '"12"', "parseInt(holder)"),
  convert("string-pad-end", "String.prototype.padEnd", "toString", "toString", '"-"', '"a".padEnd(3, holder)'),
  convert("symbol", "Symbol(..)", "toString", "toString", '"text"', "Symbol(holder).description"),
  convert("array-join", "Array.prototype.join", "toString", "toString", '"-"', "[1, 2].join(holder)"),
  convert("is-nan", "isNaN", "valueOf", "valueOf", "NaN", "isNaN(holder)"),
  convert("url-search-params", "new URLSearchParams(..), for a value of the record,", "toString", "toString", '"text"', "new URLSearchParams({ a: holder }).toString()"),
  convert("headers", "new Headers(..), for a value of the record,", "toString", "toString", '"text"', 'new Headers({ a: holder }).get("a")'),
  convert("blob", "new Blob(..), for a part,", "toString", "toString", '"text"', "await new Blob([holder]).text()"),
  ["json-stringify", "JSON.stringify", "toJSON", "toJSON", ["method", "key", 'log.push("toJSON " + (this === holder) + " " + key);\nreturn { size: item.double() };'], [], "JSON.stringify({ a: holder })", "result", ""],
  ["date-to-json", "Date.prototype.toJSON", "toISOString", "toISOString", ["method", "", SEEN.replace("%s", "toISOString") + "\nreturn item;"], [], "Date.prototype.toJSON.call(holder)", "result.double()", ""],
  ["error", "new Error(..)", "cause", "cause", ["data", "item"], [], 'new Error("message", holder)', "result.cause.double()", ""],
  ["regexp-test", "RegExp.prototype.test", "exec", "exec", ["method", "text", 'log.push("exec " + (this === holder) + " " + typeof text);\nreturn { index: item.double() };'], [], 'RegExp.prototype.test.call(holder, "text")', "result", ""],
  ["reflect-get", "Reflect.get", "x", "x", ["data", "item"], [], 'Reflect.get(holder, "x")', "result.double()", ""],
  ["object-to-string", "Object.prototype.toString", "[Symbol.toStringTag]", "Symbol.toStringTag", ["data", '"Tag" + item.double()'], [], "Object.prototype.toString.call(holder)", "result", ""],
  ["array-concat", "Array.prototype.concat", "[Symbol.isConcatSpreadable]", "Symbol.isConcatSpreadable", ["data", "true"], [["0", "item"], ["length", "1"]], "[].concat(holder)", "result.length, result[0].double()", ""],
  ["string-raw", "String.raw", "raw", "raw", ["data", '["a", "b" + item.double()]'], [], "String.raw(holder, 1)", "result", ""],
  ["function-apply", "Function.prototype.apply", "length", "length", ["data", "2"], [["0", "1.5"], ["1", "item"]], "take.apply(null, holder)", "result", 'function take(first, second) {\n  return typeof first + " " + second.double() + " " + arguments.length;\n}\n'],
  ["array-from", "Array.from", "length", "length", ["data", "2"], [["0", "1.5"], ["1", "item"]], "Array.from(holder)", "result.length, result[1].double()", ""],
  ["array-slice", "Array.prototype.slice", "length", "length", ["data", "2"], [["0", "1.5"], ["1", "item"]], "Array.prototype.slice.call(holder)", "result.length, result[1].double()", ""],
  ["readable-stream", "new ReadableStream(..)", "start", "start", ["method", "controller", SEEN.replace("%s", "start") + "\ncontroller.enqueue(item);\ncontroller.close();"], [], "await new ReadableStream(holder).getReader().read()", "result.done, result.value.double()", ""],
  ["readable-stream", "new ReadableStream(..)", "pull", "pull", ["method", "controller", SEEN.replace("%s", "pull") + "\ncontroller.enqueue(item);\ncontroller.close();"], [], "await new ReadableStream(holder).getReader().read()", "result.done, result.value.double()", ""],
  ["readable-stream", "new ReadableStream(..)", "cancel", "cancel", ["method", "reason", SEEN.replace("%s", "cancel") + "\nkept.push(reason);"], [], "await new ReadableStream(holder).cancel(item)", "result, kept[0].double()", ""],
  ["readable-stream-strategy", "new ReadableStream(.., a strategy)", "size", "size", ["method", "chunk", 'log.push("size " + typeof chunk);\nkept.push(chunk);\nreturn 1;'], [["highWaterMark", "1"]], "await new ReadableStream({\n    start(controller) {\n      controller.enqueue(item);\n      controller.close();\n    },\n  }, holder).getReader().read()", "result.value.double(), kept[0].double()", ""],
  ["writable-stream", "new WritableStream(..)", "write", "write", ["method", "chunk, controller", SEEN.replace("%s", "write") + "\nkept.push(chunk);"], [], "await new WritableStream(holder).getWriter().write(item)", "result, kept[0].double()", ""],
  ["writable-stream", "new WritableStream(..)", "close", "close", ["method", "", SEEN.replace("%s", "close")], [], "await new WritableStream(holder).getWriter().close()", "result", ""],
  ["writable-stream", "new WritableStream(..)", "abort", "abort", ["method", "reason", SEEN.replace("%s", "abort") + "\nkept.push(reason);"], [], "await new WritableStream(holder).abort(item)", "result, kept[0].double()", ""],
  ["transform-stream", "new TransformStream(..)", "transform", "transform", ["method", "chunk, controller", SEEN.replace("%s", "transform") + "\ncontroller.enqueue(chunk);"], [], "await (stream => (stream.writable.getWriter().write(item), stream.readable.getReader().read()))(new TransformStream(holder))", "result.done, result.value.double()", ""],
  ["event-target", "EventTarget.prototype.dispatchEvent, for a listener that is an object,", "handleEvent", "handleEvent", ["method", "event", 'log.push("handleEvent " + (this === holder) + " " + event.type);\nkept.push(event.detail);'], [], '(target => (target.addEventListener("ping", holder), target.dispatchEvent(new CustomEvent("ping", { detail: item }))))(new EventTarget())', "result, kept[0].double()", ""],
  ["custom-event", "new CustomEvent(..)", "detail", "detail", ["data", "item"], [], 'new CustomEvent("ping", holder)', "result.detail.double()", ""],
  ["message-event", "new MessageEvent(..)", "data", "data", ["data", "item"], [], 'new MessageEvent("message", holder)', "result.data.double()", ""],
  ["error-event", "new ErrorEvent(..)", "error", "error", ["data", "item"], [], 'new ErrorEvent("error", holder)', "result.error.double()", ""],
  ["response", "new Response(..)", "status", "status", ["data", "200 + item.double()"], [], 'new Response("body", holder)', "result.status", ""],
  ["intl-number-format", "new Intl.NumberFormat(..)", "minimumFractionDigits", "minimumFractionDigits", ["data", "item.double()"], [], 'new Intl.NumberFormat("en", holder).format(1.5)', "result", ""],
  ["bun-inspect", "Bun.inspect", '[Symbol.for("nodejs.util.inspect.custom")]', "the symbol of a custom inspection", ["method", "depth, options", 'log.push("inspects " + (this === holder) + " " + typeof depth + " " + typeof options);\nreturn "custom " + item.double();'], [], "Bun.inspect(holder)", "result", ""],
  ["disposable-stack", "DisposableStack.prototype.use", "[Symbol.dispose]", "Symbol.dispose", ["method", "", SEEN.replace("%s", "dispose") + "\nkept.push(item.double());"], [], "(stack => (stack.use(holder), stack.dispose()))(new DisposableStack())", "result, kept[0]", ""],
  ["object-assign", "Object.assign, storing into its target,", "x", "x", ["setter", "value", 'log.push("set x " + (this === holder) + " " + typeof value);\nkept.push(value);'], [], "Object.assign(holder, { x: item })", "result === holder, kept[0].double()", ""],
  ["reflect-set", "Reflect.set", "x", "x", ["setter", "value", 'log.push("set x " + (this === holder) + " " + typeof value);\nkept.push(value);'], [], 'Reflect.set(holder, "x", item)', "result, kept[0].double()", ""],
  ["array-push", "Array.prototype.push, storing the new length,", "length", "length", ["setter", "value", 'log.push("set length " + (this === holder) + " " + value);\nkept.push(value);'], [], "Array.prototype.push.call(holder, item)", "result, holder[0].double(), kept[0]", ""],
  ["array-of", "Array.of, storing the length into what its receiver makes,", "length", "length", ["setter", "value", 'log.push("set length " + (this === holder) + " " + value);\nkept.push(value);'], [], "Array.of.call(function () {\n    return holder;\n  }, item)", "result === holder, holder[0].double(), kept[0]", ""],
]];
const names = new Set();
for (const [builtin, text, key, name, kind, others, use, show, pre] of ROWS) {
  let said = name.replaceAll("Symbol.", "symbol-").replaceAll("the symbol of a custom inspection", "the-symbol-of-a-custom-inspection");
  said = said.replace(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, "-").toLowerCase();
  for (const [form, [says, make]] of Object.entries(FORMS)) {
    if (kind[0] === "setter" && form.includes("getter")) {
      continue;
    }
    const verb = kind[0] === "setter" ? "runs-the-setter-of-" : builtin === "proxy" ? "runs-the-trap-" : "reads-";
    const file = "members-" + builtin + "-" + verb + said + "-" + form;
    if (names.has(file)) throw new Error(file);
    names.add(file);
    const what = kind[0] === "setter" ? "runs the setter of " + name : builtin === "proxy" ? "reads " + name + " of its handler" : "reads " + name + " of what it is given";
    let body = pre + make(key, name, kind, others);
    body += "try {\n  const result = " + use + ";\n  console.log(" + show + ');\n} catch (error) {\n  console.log("threw " + error.constructor.name + ": " + error.message);\n}\nconsole.log(log.join("\\n"));\n';
    filesWritten[file + ".js"] = "// " + text + " " + what + "; here " + says + ".\n" + ITEM + body;
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
