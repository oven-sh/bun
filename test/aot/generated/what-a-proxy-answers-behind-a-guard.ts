// What the language lets a proxy answer for itself, asked behind every test that tells functions, objects and arrays apart. A proxy of a function is a function to `typeof`,
// a proxy of an array is an array to Array.isArray, and a revoked proxy still has its `typeof` while nearly every other question of it throws. Each proxy logs the traps it is asked for.

// `v` is the proxy.
const questions: Record<string, string> = {
  "Array.isArray": "Array.isArray(v)",
  "Array.isArray as a value": "[v].map(Array.isArray)[0]",
  "Array.isArray filter": "[v].filter(Array.isArray).length",
  "Array.isArray by call": "Array.isArray.call(null, v)",
  "Array.isArray by Reflect.apply": "Reflect.apply(Array.isArray, null, [v])",
  "Array.isArray chooses": "Array.isArray(v) ? v.length : -1",
  "not Array.isArray": "!Array.isArray(v)",
  "instanceof Function": "v instanceof Function",
  "instanceof Object": "v instanceof Object",
  "instanceof Array": "v instanceof Array",
  "instanceof Error": "v instanceof Error",
  "instanceof Proxy": "v instanceof Proxy",
  "Function.prototype.toString": "Function.prototype.toString.call(v)",
  "Object.prototype.toString": "Object.prototype.toString.call(v)",
  "toString": "v.toString()",
  "in name": '"name" in v',
  "in length": '"length" in v',
  "in 0": "0 in v",
  "in prototype": '"prototype" in v',
  "Object.keys": "Object.keys(v)",
  "Object.values": "Object.values(v)",
  "Object.entries": "Object.entries(v).length",
  "Reflect.ownKeys": "Reflect.ownKeys(v).map(String)",
  "Object.getOwnPropertyNames": "Object.getOwnPropertyNames(v)",
  "Object.getOwnPropertySymbols": "Object.getOwnPropertySymbols(v).length",
  "Object.getOwnPropertyDescriptors": "Object.keys(Object.getOwnPropertyDescriptors(v))",
  "Object.getOwnPropertyDescriptor": 'typeof Object.getOwnPropertyDescriptor(v, "length")',
  "Object.hasOwn": 'Object.hasOwn(v, "name")',
  "hasOwnProperty": 'Object.prototype.hasOwnProperty.call(v, "length")',
  "propertyIsEnumerable": 'Object.prototype.propertyIsEnumerable.call(v, "length")',
  "name": "v.name",
  "length": "v.length",
  "prototype": "typeof v.prototype",
  "constructor": "[Function, Array, Object].indexOf(v.constructor)",
  "index 0": "v[0]",
  "member": "v.member",
  "optional member": "v?.member",
  "Symbol.toStringTag": "v[Symbol.toStringTag]",
  "Symbol.iterator": "typeof v[Symbol.iterator]",
  "Symbol.hasInstance": "typeof v[Symbol.hasInstance]",
  "Object.getPrototypeOf": "[Function.prototype, Array.prototype, Object.prototype].indexOf(Object.getPrototypeOf(v))",
  "Reflect.getPrototypeOf": "[Function.prototype, Array.prototype, Object.prototype].indexOf(Reflect.getPrototypeOf(v))",
  "__proto__": "[Function.prototype, Array.prototype, Object.prototype].indexOf(v.__proto__)",
  "Function.prototype.isPrototypeOf": "Function.prototype.isPrototypeOf(v)",
  "Array.prototype.isPrototypeOf": "Array.prototype.isPrototypeOf(v)",
  "Object.prototype.isPrototypeOf": "Object.prototype.isPrototypeOf(v)",
  "Object.isExtensible": "Object.isExtensible(v)",
  "Reflect.isExtensible": "Reflect.isExtensible(v)",
  "Object.isFrozen": "Object.isFrozen(v)",
  "Object.isSealed": "Object.isSealed(v)",
  "Object.freeze": "typeof Object.freeze(v)",
  "Object.seal": "typeof Object.seal(v)",
  "Object.preventExtensions": "typeof Object.preventExtensions(v)",
  "Reflect.preventExtensions": "Reflect.preventExtensions(v)",
  "Object.setPrototypeOf": "typeof Object.setPrototypeOf(v, null)",
  "Reflect.setPrototypeOf": "Reflect.setPrototypeOf(v, null)",
  "Object.defineProperty": 'typeof Object.defineProperty(v, "member", { value: 1, configurable: true })',
  "Reflect.defineProperty": 'Reflect.defineProperty(v, "member", { value: 1, configurable: true })',
  "Reflect.has": 'Reflect.has(v, "length")',
  "Reflect.get": 'Reflect.get(v, "length")',
  "Reflect.set": 'Reflect.set(v, "member", 1)',
  "Reflect.deleteProperty": 'Reflect.deleteProperty(v, "member")',
  "store": "(v.member = 1)",
  "store 0": "(v[0] = 1)",
  "store length": "(v.length = 0)",
  "delete": "delete v.member",
  "call": "typeof v()",
  "call method": "typeof v.call(null)",
  "apply method": "typeof v.apply(null, [])",
  "Function.prototype.call": "typeof Function.prototype.call.call(v, null)",
  "Reflect.apply": "typeof Reflect.apply(v, null, [])",
  "bind": "typeof v.bind(null)",
  "Function.prototype.bind": "Function.prototype.bind.call(v, null).name",
  "new": "typeof new v()",
  "Reflect.construct": "typeof Reflect.construct(v, [])",
  "Reflect.construct as new.target": "typeof Reflect.construct(Object, [], v)",
  "right of instanceof": "({}) instanceof v",
  "hasInstance borrowed": "Function.prototype[Symbol.hasInstance].call(v, {})",
  "extends": "typeof class extends v {}",
  "extends and new": "typeof new (class extends v {})()",
  "JSON.stringify": "JSON.stringify(v)",
  "JSON.stringify inside": "JSON.stringify({ member: v })",
  "JSON.stringify in a list": "JSON.stringify([v])",
  "JSON.stringify replacer": "JSON.stringify({ a: 1, 1: 2 }, v)",
  "JSON.parse reviver": 'JSON.stringify(JSON.parse("[1]", v))',
  "structuredClone": "typeof structuredClone(v)",
  "structuredClone inside": "typeof structuredClone({ member: v })",
  "String": "String(v)",
  "template": "`${v}`",
  "plus": 'v + ""',
  "Number": "Number(v)",
  "unary plus": "+v",
  "bit or": "v | 0",
  "less than": "v < 1",
  "loosely equals text": 'v == "x"',
  "Boolean": "Boolean(v)",
  "truthy": "!!v",
  "typeof": "typeof v",
  "equals itself": "v === v",
  "Object.is": "Object.is(v, v)",
  "Object(v) is v": "Object(v) === v",
  "valueOf is v": "Object.prototype.valueOf.call(v) === v",
  "Error.isError": "Error.isError(v)",
  "ArrayBuffer.isView": "ArrayBuffer.isView(v)",
  "Number.isInteger": "Number.isInteger(v)",
  "isNaN": "isNaN(v)",
  "concat": "[].concat(v).length",
  "concat receiver": "Array.prototype.concat.call(v).length",
  "Array.from": "Array.from(v).length",
  "flat": "[v].flat().length",
  "flat receiver": "Array.prototype.flat.call(v).length",
  "slice": "Array.prototype.slice.call(v).length",
  "map borrowed": "Array.prototype.map.call(v, x => x).length",
  "filter borrowed": "Array.prototype.filter.call(v, () => true).length",
  "splice borrowed": "Array.prototype.splice.call(v, 0, 0).length",
  "join borrowed": "Array.prototype.join.call(v)",
  "Array.prototype.toString": "Array.prototype.toString.call(v)",
  "includes borrowed": "Array.prototype.includes.call(v, 1)",
  "at borrowed": "Array.prototype.at.call(v, 0)",
  "push borrowed": "Array.prototype.push.call(v, 3)",
  "spread into a list": "[...v].length",
  "spread into a call": "Math.max(...v)",
  "list of Reflect.apply": "Reflect.apply(Math.max, null, v)",
  "list of apply": "Math.max.apply(null, v)",
  "list pattern": "(([first]) => first)(v)",
  "object pattern": "(({ length }) => length)(v)",
  "rest pattern": "(({ length, ...rest }) => Object.keys(rest))(v)",
  "spread into an object": "Object.keys({ ...v })",
  "Object.assign": "Object.keys(Object.assign({}, v))",
  "Object.assign target": "typeof Object.assign(v, { member: 2 })",
  "Object.fromEntries": "Object.keys(Object.fromEntries(v))",
  "for in": "(() => { const seen = []; for (const key in v) seen.push(key); return seen; })()",
  "for of": "(() => { let sum = 0; for (const item of v) sum += item; return sum; })()",
  "new Set": "new Set(v).size",
  "new Uint8Array": "new Uint8Array(v).length",
  "key of a Map": "new Map([[v, 1]]).get(v)",
  "member of a WeakSet": "new WeakSet([v]).has(v)",
  "sort comparator": "[2, 1].sort(v)",
  "map callback": "[1].map(v).length",
  "isProxy": "types.isProxy(v)",
  "Bun.inspect": String.raw`Bun.inspect(v).split("\n").filter(line => !/^\s*(\d+ \||\^|at )/.test(line)).join("/")`,
  "Bun.deepEquals": "Bun.deepEquals(v, v)",
};

// What stands in front of the question.
export const guards: Record<string, string> = {
  "none": "true",
  "typeof-function": 'typeof v === "function"',
  "typeof-object": 'typeof v === "object"',
  "typeof-object-not-null": 'typeof v === "object" && v !== null',
  "typeof-not-function": 'typeof v !== "function"',
  "typeof-not-object": 'typeof v !== "object"',
  "typeof-either": 'v !== null && (typeof v === "object" || typeof v === "function")',
  "instanceof-function": "v instanceof Function",
  "instanceof-object": "v instanceof Object",
  "instanceof-array": "v instanceof Array",
  "is-array": "Array.isArray(v)",
  "is-no-array": "!Array.isArray(v)",
  "function-or-array": 'typeof v === "function" || Array.isArray(v)',
  "object-of-itself": "Object(v) === v",
  "tag-function": 'Object.prototype.toString.call(v) === "[object Function]"',
  "tag-array": 'Object.prototype.toString.call(v) === "[object Array]"',
  "constructor-function": "v?.constructor === Function",
  "constructor-array": "v?.constructor === Array",
  "has-call": 'typeof v.call === "function"',
};

// What the proxy is made of.
export const targets: Record<string, string> = {
  "function": "function target() { return 1; }",
  "arrow": "() => 1",
  "class": "class Target {}",
  "bound": "function target() {}.bind(null)",
  "generator": "function* target() {}",
  "array": "[1, 2]",
  "object": "{ member: 1, length: 1, 0: 5 }",
  "error": 'new Error("text")',
  "bytes": "new Uint8Array(2)",
  "proxy-of-function": "new Proxy(function inner() {}, {})",
  "proxy-of-array": "new Proxy([1, 2], {})",
};

// The type of the parameter that the proxy is handed to.
export const declaredTypes: Record<string, string> = {
  "arrow": "() => unknown",
  "function": "Function",
  "constructor": "new () => object",
  "callable-interface": "{ (): unknown; member?: number }",
  "object": "object",
  "list": "unknown[]",
  "numbers": "number[]",
  "readonly-list": "readonly unknown[]",
  "has-length": "{ length: number }",
  "has-member": "{ member?: number }",
  "record": "Record<string, unknown>",
  "array-like": "ArrayLike<unknown>",
  "iterable": "Iterable<number>",
  "function-or-list": "(() => unknown) | (() => unknown)[]",
  "function-or-object": "(() => unknown) | { member?: number }",
  "error": "Error",
  "unknown": "unknown",
};

// The text that `bun run` quotes from the source is left out of a message.
const head = `import { types } from "node:util";
const traps = [];
const handler = new Proxy({}, { get: (_, trap) => (traps.push(trap), undefined) });
function show(answer) {
  return typeof answer === "symbol" || typeof answer === "function" ? typeof answer : (JSON.stringify(answer) ?? String(answer));
}
function describe(label, error) {
  if (label === "right of instanceof") return "throws " + error.constructor.name;
  return "throws " + error.constructor.name + ": " + error.message.replace(/ \\((?:In|evaluating) '[^]*$/, "");
}
`;

const inParentheses = (target: string) => (/^(function|class|\{)/.test(target) ? `(${target})` : target);

// Each makes a proxy and, where the proxy is to be revoked behind the guard, the function that revokes it.
const makers: [string, string][] = [];
for (const [name, written] of Object.entries(targets)) {
  const target = inParentheses(written);
  makers.push([`${name}, live`, `() => [Proxy.revocable(${target}, handler).proxy, undefined]`]);
  makers.push([
    `${name}, revoked`,
    `() => { const { proxy, revoke } = Proxy.revocable(${target}, handler); revoke(); return [proxy, undefined]; }`,
  ]);
  makers.push([
    `${name}, revoked behind the guard`,
    `() => { const { proxy, revoke } = Proxy.revocable(${target}, handler); return [proxy, revoke]; }`,
  ]);
}
for (const name of ["function", "array"])
  makers.push([
    `${name}, around a revoked proxy`,
    `() => { const inner = Proxy.revocable(${inParentheses(targets[name])}, {}); const outer = new Proxy(inner.proxy, handler); inner.revoke(); return [outer, undefined]; }`,
  ]);

// One function for each question. Every kind of proxy is handed to it, so nothing is known of `v` but what the guard or the declared type says.
function programOfParameters(parameter: string, guard: string) {
  let text = head + `const makers = [\n${makers.map(([name, maker]) => `  [${JSON.stringify(name)}, ${maker}],`).join("\n")}\n];\nconst askers = [\n`;
  for (const [label, question] of Object.entries(questions))
    text += `  [${JSON.stringify(label)}, function (${parameter}, revoke) {\n    if (${guard}) {\n      revoke?.();\n      return ${question};\n    }\n    return "the guard is false";\n  }],\n`;
  return (
    text +
    `];
for (const [label, ask] of askers) {
  for (const [kind, make] of makers) {
    const [value, revoke] = make();
    traps.length = 0;
    let line;
    try {
      line = show(ask(value, revoke));
    } catch (error) {
      line = describe(label, error);
    }
    console.log(label, "|", kind, "|", line, "|", traps.join());
  }
}
`
  );
}

export function programOfProxiesHandedOver(guard: string) {
  return { file: "main.js", text: programOfParameters("v", guards[guard]) };
}

export function programOfDeclaredParameter(type: string) {
  return { file: "main.ts", text: "// @ts-nocheck\n" + programOfParameters(`v: ${declaredTypes[type]}`, "true") };
}

// The proxy is made by `new Proxy` in the function that asks, so its class is known there.
export function programOfProxyMadeInPlace(target: string) {
  let text = head;
  let count = 0;
  for (const guard of ["none", "typeof-function", "typeof-object", "is-array", "instanceof-function", "typeof-either"]) {
    for (const [label, question] of Object.entries(questions)) {
      const line = JSON.stringify(`${guard} | ${label}`);
      text += `function block${count}() {
  const v = new Proxy(${inParentheses(targets[target])}, handler);
  traps.length = 0;
  try {
    if (${guards[guard]}) console.log(${line}, "|", show(${question}), "|", traps.join());
    else console.log(${line}, "| the guard is false |", traps.join());
  } catch (error) {
    console.log(${line}, "|", describe(${JSON.stringify(label)}, error), "|", traps.join());
  }
}
block${count}();
`;
      count++;
    }
  }
  return { file: "main.js", text };
}
