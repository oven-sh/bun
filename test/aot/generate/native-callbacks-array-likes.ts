// Programs of native-callbacks, array-likes-*.js. `bun test/aot/generate.ts native-callbacks <where>` writes them.
// Every built-in that takes an array-like (`this` or an argument) with ONE INDEX INHERITED: data and getter, one and two objects above, an array with a hole whose prototype object has the element, the prototype object of a class.
// ONE BUILT-IN AND ONE FORM A PROGRAM. What stands under the inherited index is an instance whose methods nothing else reaches: `double` is called on what comes out, `toString` by native code.
// Plain Bun is the reference, but for Array.prototype.reverse over an inherited getter and setter, where the executable does what ECMAScript says and plain Bun does not: there the output is stored.
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
  toString() {
    log.push("toString " + (this === item));
    return "item " + this.size;
  }
}
const log = [];
const seen = [];
const item = new Item(1.5);
`;

function own(first: any, third: any, length: any, indent = "  ") {
  return indent + "0: " + first + ",\n" + (length === 3 ? indent + "2: " + third + ",\n" : "") + indent + "length: " + String(length) + ",\n";
}
function accessor(inherited: any, indent: string) {
  return indent + "get 1() {\n" + indent + '  log.push("get 1 " + (this === like));\n' + indent + "  return " + inherited + ";\n" + indent + "},\n" +
    indent + "set 1(value) {\n" + indent + '  log.push("set 1 " + (this === like) + " " + typeof value);\n' + indent + "},\n";
}
const FORMS: Record<string, [string, (a: any, b: any, c: any, n: any) => string]> = {
  "an-element-that-a-plain-object-inherits": [
    "it is a plain object, and the element stands in the plain object above it",
    (a, b, c, n) => "const like = {\n  __proto__: { 1: " + b + " },\n" + own(a, c, n) + "};\n",
  ],
  "a-getter-that-a-plain-object-inherits": [
    "it is a plain object, and the plain object above it has a getter and a setter there",
    (a, b, c, n) => "const like = {\n  __proto__: {\n" + accessor(b, "    ") + "  },\n" + own(a, c, n) + "};\n",
  ],
  "an-element-from-two-objects-above": [
    "it is a plain object, and the element stands two plain objects above it",
    (a, b, c, n) => "const like = {\n  __proto__: { __proto__: { 1: " + b + " } },\n" + own(a, c, n) + "};\n",
  ],
  "a-getter-from-two-objects-above": [
    "it is a plain object, and the plain object two above it has a getter and a setter there",
    (a, b, c, n) => "const like = {\n  __proto__: {\n    __proto__: {\n" + accessor(b, "      ") + "    },\n  },\n" + own(a, c, n) + "};\n",
  ],
  "an-element-that-an-array-with-a-hole-inherits": [
    "it is an array with a hole there, and the object that was made its prototype has the element",
    (a, b, c, n) => "const like = [" + a + "];\n" + (n === 3 ? "like[2] = " + c + ";\n" : "like.length = 2;\n") + "Object.setPrototypeOf(like, { __proto__: Array.prototype, 1: " + b + " });\n",
  ],
  "an-element-on-the-prototype-object-of-a-class": [
    "it is an instance of a class, and the element was stored into the prototype object of the class",
    (a, b, c, n) => "class Like {\n  0 = " + a + ";\n" + (n === 3 ? "  2 = " + c + ";\n" : "") + "  length = " + String(n) + ";\n}\nLike.prototype[1] = " + b + ";\nconst like = new Like();\n",
  ],
};

const LOOK = 'value => {\n    seen.push(typeof value === "object" ? value.double() : typeof value);\n    return true;\n  }';
const IS = 'value => typeof value === "object" && value.double() === 3';
const A = "Array.prototype.";
// name -> (how the text names it, the call, what is shown, more: length | values | statements behind the form | statements in front)
const BUILTINS: Record<string, [string, string, string, Record<string, any>?]> = {
  at: [A + "at", A + "at.call(like, 1)", "result.double()"],
  "concat-of-a-spreadable-receiver": [A + "concat, whose receiver says it is spreadable,", A + "concat.call(like)", "result.length, result[1].double()", { after: "like[Symbol.isConcatSpreadable] = true;\n" }],
  "concat-of-a-spreadable-argument": [A + "concat, whose argument says it is spreadable,", "[].concat(like)", "result.length, result[1].double()", { after: "like[Symbol.isConcatSpreadable] = true;\n" }],
  "copy-within": [A + "copyWithin", A + "copyWithin.call(like, 0, 1, 2)", "result === like, like[0].double()"],
  entries: ["The iterator of " + A + "entries", "[..." + A + "entries.call(like)]", "result.length, result[1][1].double()"],
  values: ["The iterator of " + A + "values", "[..." + A + "values.call(like)]", "result.length, result[1].double()"],
  every: [A + "every", A + "every.call(like, " + LOOK + ")", "result, seen.join()"],
  filter: [A + "filter", A + "filter.call(like, " + LOOK + ")", "result.length, result[1].double(), seen.join()"],
  find: [A + "find", A + 'find.call(like, value => typeof value === "object")', "result.double()"],
  "find-index": [A + "findIndex", A + "findIndex.call(like, " + IS + ")", "result"],
  "find-last": [A + "findLast", A + 'findLast.call(like, value => typeof value === "object")', "result.double()"],
  "find-last-index": [A + "findLastIndex", A + "findLastIndex.call(like, " + IS + ")", "result"],
  flat: [A + "flat", A + "flat.call(like)", "result.length, result[1].double()"],
  "flat-map": [A + "flatMap", A + "flatMap.call(like, value => [value])", "result.length, result[1].double()"],
  "for-each": [A + "forEach", A + "forEach.call(like, " + LOOK + ")", "result, seen.join()"],
  includes: [A + "includes", A + "includes.call(like, item)", "result"],
  "index-of": [A + "indexOf", A + "indexOf.call(like, item)", "result"],
  "last-index-of": [A + "lastIndexOf", A + "lastIndexOf.call(like, item)", "result"],
  join: [A + "join", A + 'join.call(like, "-")', "result"],
  map: [A + "map", A + "map.call(like, value => value)", "result.length, result[1].double()"],
  pop: [A + "pop", A + "pop.call(like)", "result.double(), like.length", { length: 2 }],
  reduce: [A + "reduce", A + 'reduce.call(like, (sum, value) => sum + (typeof value === "object" ? value.double() : 0), 0)', "result"],
  "reduce-right": [A + "reduceRight", A + 'reduceRight.call(like, (sum, value) => sum + (typeof value === "object" ? value.double() : 0), 0)', "result"],
  reverse: [A + "reverse", A + "reverse.call(like)", 'result === like, typeof like[0] === "object" ? like[0].double() : typeof like[0], typeof like[1]', { length: 2 }],
  shift: [A + "shift", A + "shift.call(like)", "result, like[0].double(), like.length"],
  slice: [A + "slice", A + "slice.call(like)", "result.length, result[1].double()"],
  some: [A + "some", A + "some.call(like, " + IS + ")", "result"],
  "sort-with-a-comparator": [A + "sort", A + "sort.call(like, (a, b) => {\n    seen.push(typeof a + typeof b);\n    return 0;\n  })", 'result === like, seen.length > 0, [like[0], like[1], like[2]].find(value => typeof value === "object").double()'],
  "sort-by-texts": [A + "sort without a comparator", A + "sort.call(like)", "result === like, [like[0], like[1], like[2]].map(value => typeof value).join()"],
  splice: [A + "splice", A + "splice.call(like, 1, 1)", "result.length, result[0].double(), like.length"],
  "to-locale-string": [A + "toLocaleString", A + "toLocaleString.call(like)", "result"],
  "to-reversed": [A + "toReversed", A + "toReversed.call(like)", "result.length, result[1].double()"],
  "to-sorted": [A + "toSorted", A + "toSorted.call(like, () => 0)", 'result.length, result.find(value => typeof value === "object").double()'],
  "to-spliced": [A + "toSpliced", A + "toSpliced.call(like, 0, 1)", "result.length, result[0].double()"],
  "to-string": [A + "toString, by the join that the object has,", A + "toString.call(like)", "result", { after: "like.join = Array.prototype.join;\n" }],
  unshift: [A + "unshift", A + 'unshift.call(like, "first")', "result, like[2].double()"],
  with: [A + "with", A + 'with.call(like, 0, "first")', "result.length, result[1].double()"],
  "array-from": ["Array.from", "Array.from(like)", "result.length, result[1].double()"],
  "array-from-with-a-function": ["Array.from with a function", "Array.from(like, " + LOOK + ")", "result.join(), seen.join()"],
  "array-from-async": ["Array.fromAsync", "await Array.fromAsync(like)", "result.length, result[1].double()"],
  "function-apply": ["Function.prototype.apply", "take.apply(null, like)", "result", { before: 'function take(first, second) {\n  return typeof first + " " + second.double() + " " + arguments.length;\n}\n' }],
  "reflect-apply": ["Reflect.apply", "Reflect.apply(take, null, like)", "result", { before: 'function take(first, second) {\n  return typeof first + " " + second.double() + " " + arguments.length;\n}\n' }],
  "reflect-construct": ["Reflect.construct", "Reflect.construct(Taker, like)", "result.answer", { before: 'class Taker {\n  constructor(first, second) {\n    this.answer = typeof first + " " + second.double() + " " + arguments.length;\n  }\n}\n' }],
  "reflect-construct-of-array": ["Reflect.construct of Array", "Reflect.construct(Array, like)", "result.length, result[1].double()"],
  "apply-of-a-bound-function": ["Function.prototype.apply of a bound function", 'take.bind(null, "bound").apply(null, like)', "result", { before: 'function take(bound, first, second) {\n  return bound + " " + typeof first + " " + second.double() + " " + arguments.length;\n}\n' }],
  "apply-of-array-push": [A + "push, applied,", A + "push.apply(target, like)", "result, target[1].double()", { before: "const target = [];\n" }],
  "apply-of-array": ["Array, applied,", "Array.apply(null, like)", "result.length, result[1].double()"],
  "apply-of-array-of": ["Array.of, applied,", "Array.of.apply(null, like)", "result.length, result[1].double()"],
  "apply-of-math-max": ["Math.max, applied,", "Math.max.apply(null, like)", "result"],
  "apply-of-string-concat": ["String.prototype.concat, applied,", 'String.prototype.concat.apply("", like)', "result"],
  "apply-of-console-log": ["console.log, applied,", "console.log.apply(console, like)", "result"],
  "apply-of-object-assign": ["Object.assign, applied,", "Object.assign.apply(null, like)", "result.held.double()", { values: ["{}", "{ held: item }", "{ more: 1.5 }"] }],
  "apply-of-set-timeout": ["setTimeout, applied,", "await new Promise(resolve => setTimeout.apply(null, Object.assign(like, { 0: (value, more) => resolve(more.double()) })))", "result", { values: ["null", "0", "item"], "third-inherited": true }],
  "string-raw": ["String.raw", 'String.raw({ raw: like }, "+", "+")', "result"],
  "float64-array": ["new Float64Array(..)", "new Float64Array(like)", "result.length, result[0], result[1]"],
  "float64-array-from": ["Float64Array.from", "Float64Array.from(like)", "result.length, result[0], result[1]"],
  "typed-array-set": ["%TypedArray%.prototype.set", "target.set(like)", "result, target[0], target[1]", { before: "const target = new Float64Array(3);\n" }],
  "buffer-from": ["Buffer.from", "Buffer.from(like)", "result.length, result[0], result[1]"],
  "the-keys-a-proxy-answers-with": ["Reflect.ownKeys of a proxy, whose trap answers with the object,", "Reflect.ownKeys(new Proxy({}, { ownKeys: () => like }))", "result.join()", { values: ['"a"', '"b"', '"c"'] }],
  "intl-get-canonical-locales": ["Intl.getCanonicalLocales", "Intl.getCanonicalLocales(like)", "result.join()", { values: ['"en"', '"de"', '"fr"'] }],
};
for (const [builtin, [text, call, show, more = {}]] of Object.entries(BUILTINS)) {
  if (more["third-inherited"]) {
    continue;
  }
  const [first, inherited, third] = more["values"] ?? ["1.5", "item", '"two"'];
  for (const [form, [says, make]] of Object.entries(FORMS)) {
    let body = (more["before"] ?? "") + make(first, inherited, third, more["length"] ?? 3) + (more["after"] ?? "");
    body += "try {\n  const result = " + call + ";\n  console.log(" + show + ');\n} catch (error) {\n  console.log("threw " + error.constructor.name + ": " + error.message);\n}\nconsole.log(log.join("\\n"));\n';
    const differs = builtin === "reverse" && form.includes("getter");
    const note = differs ? " ECMAScript has it ask for index 1 up the chain, run the getter, and store through the setter; plain Bun runs neither and takes the index for absent, so the output is stored." : "";
    filesWritten["array-likes-" + builtin + "-reads-" + form + ".js"] = "// " + text + " reads index 1 of what it is given; here " + says + "." + note + "\n" + ITEM + body;
    if (differs) {
      filesWritten["array-likes-" + builtin + "-reads-" + form + ".expected.txt"] = "true 3 object\nget 1 true\nset 1 true number\nget 1 true\n";
    }
  }
}

export const programs = (): WrittenProgram[] => programsOf(filesWritten);
