// A function is entered through call, apply or Reflect.apply, and it declares things: variables that closures share, functions, classes, objects, generators. Each entry makes them anew, however often the one place
// that enters it runs and whatever other door leads into the same function.
//
//   the function  an expression with and without a name, written in place, declared, an arrow, a method, a static method, a method of a prototype, one that another function returns, an async one
//   reached       by its name; through a getter, a list, a function that returns it, a conditional, a proxy's trap, a property descriptor
//   the road      call, apply, Reflect.apply; by a computed name, optionally; bind and then call; call of call, apply of apply, call bound to the function, Reflect.apply of call; a proxy of the function; a spread list;
//                 forEach and map with Function.prototype.call as their callback; an own member `call`, a prototype with another `call`; a function of the program that calls what it is given
//   around it     nothing, or one to three functions that are themselves written in place and entered through call, apply, Reflect.apply or at once
//   how often     once; in every kind of loop; in a function that is called twice, recursive, bound, a getter, a setter, a conversion, a trap, an iterator, a constructor, a field's initializer, a default value, a tag,
//                 a generator, a callback of a built-in, a listener, text made at run time; in a timer, a microtask, a reaction, a thenable
//   another door  a plain call under another name, `new`, a tag, a getter, a conversion, a callback of a built-in, a timer, a bound copy, a proxy; its own name, its `this` or its argument kept and called later
//   then          everything that was made is called twice, counted as a set, and the first is compared with the last
import type { Random } from "./random";
import { declares } from "./what-a-callback-declares-however-it-reaches-a-built-in";

const prelude = `import { EventEmitter } from "node:events";
const made = [];
const kept = [];
let ticket = 0;
let quiet = false;
function tell(label) {
  const said = [];
  for (let round = 0; round < 2; round++) said.push(made.map(one => { try { return String(one()); } catch (error) { return error.constructor.name; } }).join());
  if (!quiet) console.log(label, made.length, said.join(" "), new Set(made).size, made.length > 1 ? made[0] === made[made.length - 1] : "");
  made.length = 0;
  kept.length = 0;
}
function enter(entered, self, ...rest) {
  return entered.call(self, ...rest);
}
function other() {
  made.push(() => "other");
}
const pause = () => new Promise(done => setTimeout(done, 1));`;

const join = (...parts: string[]) => parts.filter(part => part !== "").join(", ");

/** `twice`: the road writes the function twice, so it needs a name. */
type Road = { twice?: boolean; write: (f: string, self: string, given: string) => string };
const roads: Road[] = [
  ...[1, 2, 3, 4].map(() => ({ write: (f: string, self: string, given: string) => `${f}.call(${join(self, given)})` })),
  ...[1, 2, 3].map(() => ({ write: (f: string, self: string, given: string) => `${f}.apply(${self}, [${given}])` })),
  ...[1, 2, 3].map(() => ({
    write: (f: string, self: string, given: string) => `Reflect.apply(${f}, ${self}, [${given}])`,
  })),
  { write: (f, self, given) => `${f}["call"](${join(self, given)})` },
  { write: (f, self, given) => `${f}?.call(${join(self, given)})` },
  { write: (f, self, given) => `${f}.call?.(${join(self, given)})` },
  { write: (f, self, given) => `${f}.call(...[${join(self, given)}])` },
  { write: (f, self, given) => `${f}.apply(${self}, { length: ${given ? 1 : 0}${given ? `, 0: ${given}` : ""} })` },
  { write: (f, self, given) => `${f}.bind(${self}).call(${join("null", given)})` },
  { write: (f, self, given) => `${f}.bind(${join(self, given)}).apply(null, [])` },
  { write: (f, self, given) => `Reflect.apply(${f}.bind(${self}), null, [${given}])` },
  { twice: true, write: (f, self, given) => `${f}.call.call(${join(f, self, given)})` },
  { twice: true, write: (f, self, given) => `(0, ${f}.call).call(${join(f, self, given)})` },
  { twice: true, write: (f, self, given) => `${f}.apply.call(${f}, ${self}, [${given}])` },
  { write: (f, self, given) => `Function.prototype.call.call(${join(f, self, given)})` },
  { write: (f, self, given) => `Function.prototype.call.apply(${f}, [${join(self, given)}])` },
  { write: (f, self, given) => `Function.prototype.apply.call(${f}, ${self}, [${given}])` },
  { write: (f, self, given) => `Function.prototype.apply.apply(${f}, [${self}, [${given}]])` },
  { write: (f, self, given) => `Reflect.apply(Function.prototype.call, ${f}, [${join(self, given)}])` },
  { write: (f, self, given) => `Reflect.apply(Function.prototype.apply, ${f}, [${self}, [${given}]])` },
  { write: (f, self, given) => `Function.prototype.call.bind(${f})(${join(self, given)})` },
  { write: (f, self, given) => `Function.prototype.call.bind(${f}, ${self})(${given})` },
  { write: (f, self, given) => `new Proxy(${f}, {}).call(${join(self, given)})` },
  { write: (f, self, given) => `Reflect.apply(new Proxy(${f}, {}), ${self}, [${given}])` },
  { write: (f, self, given) => `enter(${join(f, self, given)})` },
  { write: (f, self, given) => `enter.call(${join("null", f, self, given)})` },
  { write: (f, self) => `[${self}].forEach(Function.prototype.call, ${f})` },
  { write: (f, self) => `[${self}, ${self}].forEach(Function.prototype.call, ${f})` },
  { write: (f, self) => `[${self}].map(Function.prototype.call.bind(${f}))` },
  { write: (f, self) => `[${self}, ${self}, ${self}].map(Function.prototype.call.bind(${f}))` },
  { write: (f, self, given) => `[[${join(self, given)}]].forEach(all => ${f}.call(...all))` },
];

/** Functions written in place around the expression, each with one entry. */
const shells: ((inner: string) => string)[] = [
  inner => `(function () {\n  return ${inner};\n}).call(null)`,
  inner => `(function () {\n  return ${inner};\n}).call(this)`,
  inner => `(function () {\n  return ${inner};\n}).apply(null, [])`,
  inner => `Reflect.apply(function () {\n  return ${inner};\n}, null, [])`,
  inner => `(() => ${inner})()`,
  inner => `(function () {\n  return ${inner};\n})()`,
  inner => `(() => ${inner}).call(null)`,
];

/** How often the one place runs. `e` is an expression, `n` makes names of the scene's own. */
type Often = { waits?: boolean; write: (e: string, n: string) => string };
const once: Often = { write: e => `${e};` };
const often: Often[] = [
  { write: e => `for (let i = 0; i < 3; i++) ${e};` },
  { write: e => `let left = 2;\nwhile (left--) ${e};` },
  { write: e => `let left = 2;\ndo ${e};\nwhile (--left);` },
  { write: e => `for (const each of [1, 2]) ${e};` },
  { write: e => `for (const key in { a: 1, b: 2 }) ${e};` },
  { write: e => `let left = 3;\nagain: for (;;) {\n  ${e};\n  if (--left) continue again;\n  break;\n}` },
  {
    write: e =>
      `for (let tries = 0; ; tries++) {\n  try {\n    ${e};\n    if (tries < 1) throw new Error("again");\n    break;\n  } catch {}\n}`,
  },
  { write: (e, n) => `function go${n}() {\n  ${e};\n}\ngo${n}();\ngo${n}();` },
  { write: (e, n) => `const go${n} = () => ${e};\ngo${n}();\ngo${n}();` },
  { write: (e, n) => `function go${n}() {\n  ${e};\n}\ngo${n}.call(null);\ngo${n}.call(null);` },
  { write: (e, n) => `function go${n}() {\n  ${e};\n}\ngo${n}.call(null);\ngo${n}();` },
  { write: (e, n) => `function go${n}() {\n  ${e};\n}\nfor (const road of ["call", "apply"]) go${n}[road](null);` },
  {
    write: (e, n) =>
      `function go${n}() {\n  ${e};\n}\nconst bound${n} = go${n}.bind(null);\nbound${n}();\nbound${n}();`,
  },
  { write: (e, n) => `function go${n}(left) {\n  ${e};\n  if (left) go${n}(left - 1);\n}\ngo${n}(2);` },
  {
    write: (e, n) =>
      `function go${n}(left) {\n  ${e};\n  if (left) go${n}.call(null, left - 1);\n}\ngo${n}.call(null, 1);`,
  },
  {
    write: (e, n) =>
      `function ping${n}(left) {\n  ${e};\n  if (left) pong${n}(left);\n}\nfunction pong${n}(left) {\n  ping${n}(left - 1);\n}\nping${n}(1);`,
  },
  {
    write: (e, n) => `function go${n}(next, left) {\n  ${e};\n  if (left) next(next, left - 1);\n}\ngo${n}(go${n}, 1);`,
  },
  {
    write: (e, n) =>
      `const walker${n} = {\n  go(left) {\n    ${e};\n    if (left) this.go(left - 1);\n  },\n};\nwalker${n}.go(1);`,
  },
  { write: (e, n) => `const asked${n} = {\n  get now() {\n    return ${e};\n  },\n};\nasked${n}.now;\nasked${n}.now;` },
  {
    write: (e, n) =>
      `const asked${n} = {\n  get now() {\n    return ${e};\n  },\n};\nObject.assign({}, asked${n});\n({ ...asked${n} });`,
  },
  {
    write: (e, n) =>
      `const asked${n} = {\n  get now() {\n    ${e};\n    return 1;\n  },\n};\nJSON.stringify(asked${n});\nObject.values(asked${n});`,
  },
  {
    write: (e, n) =>
      `const told${n} = {\n  set now(value) {\n    ${e};\n  },\n};\ntold${n}.now = 1;\ntold${n}.now = 2;`,
  },
  {
    write: (e, n) =>
      `const number${n} = {\n  valueOf() {\n    ${e};\n    return 1;\n  },\n};\n+number${n};\nnumber${n} * 2;`,
  },
  {
    write: (e, n) =>
      `const text${n} = {\n  toString() {\n    ${e};\n    return "";\n  },\n};\n\`\${text${n}}\`;\ntext${n} + "";`,
  },
  {
    write: (e, n) =>
      `const either${n} = {\n  [Symbol.toPrimitive]() {\n    ${e};\n    return 1;\n  },\n};\neither${n} + 1;\neither${n} < 2;`,
  },
  {
    write: (e, n) =>
      `const trapped${n} = new Proxy({}, {\n  get() {\n    return ${e};\n  },\n});\ntrapped${n}.a;\ntrapped${n}.b;`,
  },
  {
    write: (e, n) =>
      `const trapped${n} = new Proxy({}, {\n  has() {\n    ${e};\n    return true;\n  },\n});\n"a" in trapped${n};\n"b" in trapped${n};`,
  },
  {
    write: (e, n) =>
      `const walked${n} = {\n  [Symbol.iterator]() {\n    ${e};\n    return [][Symbol.iterator]();\n  },\n};\n[...walked${n}];\nfor (const each of walked${n});`,
  },
  {
    write: (e, n) =>
      `const walked${n} = {\n  [Symbol.iterator]() {\n    let turns = 0;\n    return {\n      next() {\n        ${e};\n        return { done: ++turns > 1, value: turns };\n      },\n    };\n  },\n};\n[...walked${n}];`,
  },
  {
    write: (e, n) =>
      `class Built${n} {\n  constructor() {\n    ${e};\n  }\n}\nnew Built${n}();\nReflect.construct(Built${n}, []);`,
  },
  { write: (e, n) => `class Built${n} {\n  field = ${e};\n}\nnew Built${n}();\nnew Built${n}();` },
  {
    write: (e, n) =>
      `class Base${n} {\n  constructor() {\n    ${e};\n  }\n}\nclass Below${n} extends Base${n} {}\nnew Below${n}();\nnew Base${n}();`,
  },
  { write: (e, n) => `function asks${n}(value = ${e}) {}\nasks${n}();\nasks${n}();` },
  { write: (e, n) => `function tag${n}() {\n  ${e};\n}\ntag${n}\`a\`;\ntag${n}\`b\`;` },
  { write: (e, n) => `function* steps${n}() {\n  ${e};\n}\nsteps${n}().next();\nsteps${n}().next();` },
  {
    write: (e, n) =>
      `function* steps${n}() {\n  for (;;) yield ${e};\n}\nconst walk${n} = steps${n}();\nwalk${n}.next();\nwalk${n}.next();`,
  },
  { write: e => `[1, 2, 3].forEach(() => ${e});` },
  { write: e => `[1, 2].map(function () {\n  return ${e};\n});` },
  { write: e => `Array.from({ length: 2 }, () => ${e});` },
  { write: e => `"ab".replace(/./g, () => (${e}, ""));` },
  { write: e => `JSON.stringify([1], (key, value) => (${e}, value));` },
  { write: e => `new Map([[1, 1], [2, 2]]).forEach(() => ${e});` },
  { write: e => `new Set([1, 2]).forEach(() => ${e});` },
  { write: e => `[1, 2, 3].reduce(() => ${e});` },
  { write: e => `Array.prototype.forEach.call({ length: 2, 0: 1, 1: 2 }, () => ${e});` },
  {
    write: (e, n) =>
      `const target${n} = new EventTarget();\ntarget${n}.addEventListener("go", () => ${e});\ntarget${n}.dispatchEvent(new Event("go"));\ntarget${n}.dispatchEvent(new Event("go"));`,
  },
  {
    write: (e, n) =>
      `const emitter${n} = new EventEmitter();\nemitter${n}.on("go", () => ${e});\nemitter${n}.emit("go");\nemitter${n}.emit("go");`,
  },
  { write: e => `new Function("go", "go(); go();")(() => ${e});` },
  { waits: true, write: (e, n) => `const go${n} = () => ${e};\nsetTimeout(go${n});\nsetTimeout(go${n});` },
  {
    waits: true,
    write: (e, n) =>
      `let left${n} = 2;\nconst timer${n} = setInterval(() => {\n  ${e};\n  if (!--left${n}) clearInterval(timer${n});\n});\nawait pause();\nawait pause();`,
  },
  { waits: true, write: (e, n) => `const go${n} = () => ${e};\nqueueMicrotask(go${n});\nqueueMicrotask(go${n});` },
  { waits: true, write: (e, n) => `const go${n} = () => {\n  ${e};\n};\nPromise.resolve().then(go${n}).then(go${n});` },
  { waits: true, write: (e, n) => `const go${n} = () => ${e};\nprocess.nextTick(go${n});\nsetImmediate(go${n});` },
  {
    waits: true,
    write: (e, n) =>
      `const later${n} = {\n  then(settle) {\n    ${e};\n    settle();\n  },\n};\nawait later${n};\nawait later${n};`,
  },
  {
    waits: true,
    write: (e, n) => `async function go${n}() {\n  await null;\n  ${e};\n}\nawait Promise.all([go${n}(), go${n}()]);`,
  },
  {
    waits: true,
    write: (e, n) =>
      `async function* steps${n}() {\n  yield 1;\n  yield 2;\n}\nfor await (const each of steps${n}()) ${e};`,
  },
  {
    waits: true,
    write: (e, n) => `function go${n}(left) {\n  ${e};\n  if (left) setTimeout(go${n}, 0, left - 1);\n}\ngo${n}(1);`,
  },
];

/** Another way into the same function. `f` is a name. `builds`: only what `new` accepts; `converts`: the answer must be no object. */
type Door = { waits?: boolean; builds?: boolean; converts?: boolean; write: (f: string, n: string) => string };
const doors: Door[] = [
  { write: f => `${f}();` },
  { write: f => `(0, ${f})();` },
  { write: f => `${f}?.();` },
  { write: (f, n) => `const alias${n} = ${f};\nalias${n}();` },
  { write: f => `[${f}][0]();` },
  { write: f => `({ member: ${f} }).member();` },
  { write: f => `${f}.call(null);` },
  { write: f => `${f}.apply(null);` },
  { write: f => `${f}.bind(null)();` },
  { write: f => `new Proxy(${f}, {})();` },
  { builds: true, write: f => `new ${f}();` },
  { builds: true, write: f => `Reflect.construct(${f}, []);` },
  { builds: true, write: (f, n) => `class Below${n} extends ${f} {}\nnew Below${n}();` },
  { write: f => `${f}\`tagged\`;` },
  { write: f => `Object.defineProperty({}, "now", { get: ${f} }).now;` },
  { write: f => `Object.defineProperty({}, "now", { set: ${f} }).now = 1;` },
  { converts: true, write: f => `({ valueOf: ${f} }) + 1;` },
  { converts: true, write: f => `\`\${{ toString: ${f} }}\`;` },
  { write: f => `[1].forEach(${f});` },
  { write: f => `[1, 2].map(${f});` },
  { write: f => `Array.from({ length: 2 }, ${f});` },
  { write: f => `"a".replace("a", ${f});` },
  { write: f => `JSON.parse("1", ${f});` },
  { write: f => `new Promise(${f});` },
  { write: f => `new Proxy({}, { get: ${f} }).any;` },
  { write: f => `new Function("door", "door();")(${f});` },
  {
    write: (f, n) => `const emitter${n} = new EventEmitter();\nemitter${n}.once("go", ${f});\nemitter${n}.emit("go");`,
  },
  { waits: true, write: f => `setTimeout(${f});` },
  { waits: true, write: f => `queueMicrotask(${f});` },
  { waits: true, write: f => `Promise.resolve().then(${f});` },
];

function scene(random: Random, index: number): string {
  const n = String(index);
  const f = `entered${n}`;
  const leak = random.weighted([[6, "none"], [1, "own name"], [1, "this"], [1, "handed"]] as const); // prettier-ignore
  let kind = random.weighted([[4, "in place"], [3, "expression"], [2, "named"], [2, "declared"], [1, "arrow"], [1, "method"], [1, "static"], [1, "of a prototype"], [1, "returned"], [1, "async"]] as const); // prettier-ignore
  if (leak === "own name") kind = "named";
  if (leak !== "none" && (kind === "in place" || kind === "arrow")) kind = "expression";
  const door =
    kind !== "in place" && random.chance(0.45)
      ? random.pick(
          doors.filter(
            one =>
              (!one.converts || kind !== "async") &&
              (!one.builds || kind === "expression" || kind === "named" || kind === "declared" || kind === "returned"),
          ),
        )
      : undefined;
  const changed =
    kind !== "in place" && kind !== "declared" && random.chance(0.08)
      ? random.pick(["own call", "prototype"] as const)
      : undefined;
  const how = random.chance(door || leak !== "none" ? 0.6 : 0.25) ? once : random.pick(often);

  const body = `  const item = ++ticket;\n  ${random.pick(declares)}${leak === "own name" ? `\n  kept.push(itself);` : leak === "this" ? `\n  if (typeof this === "function") kept.push(this);` : leak === "handed" ? `\n  if (typeof handed === "function") kept.push(handed);` : ""}`;
  const text = `function ${kind === "named" ? "itself" : ""}(handed) {\n${body}\n}`;
  const declared =
    kind === "in place" ? ""
    : kind === "declared" ? `function ${f}(handed) {\n${body}\n}`
    : kind === "arrow" ? `const ${f} = handed => {\n${body}\n};`
    : kind === "method" ? `const ${f} = {\n  member(handed) {\n${body}\n  },\n}.member;`
    : kind === "static" ? `const ${f} = class {\n  static member(handed) {\n${body}\n  }\n}.member;`
    : kind === "of a prototype" ? `const ${f} = class {\n  member(handed) {\n${body}\n  }\n}.prototype.member;`
    : kind === "returned" ? `function make${n}() {\n  return ${text};\n}\nconst ${f} = make${n}();`
    : kind === "async" ? `const ${f} = async ${text};`
    : `const ${f} = ${text};`; // prettier-ignore

  const reach = kind === "in place" ? "in place" : random.weighted([[8, "name"], [1, "getter"], [1, "list"], [1, "function"], [1, "conditional"], [1, "trap"], [1, "descriptor"]] as const); // prettier-ignore
  const before =
    reach === "getter" ? `const holder${n} = {\n  get door() {\n    return ${f};\n  },\n};`
    : reach === "list" ? `const holder${n} = [${f}, other];`
    : reach === "function" ? `const holder${n} = () => ${f};`
    : reach === "trap" ? `const holder${n} = new Proxy({}, { get: () => ${f} });`
    : reach === "descriptor" ? `const holder${n} = { door: ${f} };`
    : ""; // prettier-ignore
  const reached =
    reach === "in place" ? `(${text})`
    : reach === "getter" ? `holder${n}.door`
    : reach === "list" ? `holder${n}[0]`
    : reach === "function" ? `holder${n}()`
    : reach === "conditional" ? `(ticket >= 0 ? ${f} : other)`
    : reach === "trap" ? `holder${n}.any`
    : reach === "descriptor" ? `Object.getOwnPropertyDescriptor(holder${n}, "door").value`
    : f; // prettier-ignore

  const road = random.pick(kind === "in place" ? roads.filter(one => !one.twice) : roads);
  let expression = road.write(
    reached,
    leak === "this" ? f : random.pick(["null", "undefined", "{}", "made"]),
    leak === "handed" ? f : random.pick(["", "", "1"]),
  );
  for (
    let depth = random.weighted([
      [5, 0],
      [3, 1],
      [1, 2],
      [1, 3],
    ]);
    depth > 0;
    depth--
  )
    expression = random.pick(shells)(expression);

  const change =
    changed === "own call" ? `${f}.call = function (self) {\n  Reflect.apply(this, self, []);\n  return Reflect.apply(this, self, []);\n};`
    : changed === "prototype" ? `Object.setPrototypeOf(${f}, {\n  call(self) {\n    Function.prototype.call.call(this, self);\n    return Function.prototype.call.call(this, self);\n  },\n  apply: Function.prototype.apply,\n  bind: Function.prototype.bind,\n});`
    : ""; // prettier-ignore
  const later =
    leak === "none"
      ? ""
      : random.pick([
          `kept[0]?.();`,
          `kept[0]?.call(null);`,
          `for (const one of kept.splice(0)) one();`,
          `if (kept.length) Reflect.apply(kept[0], null, []);`,
        ]);
  const other = door ? door.write(f, `${n}d`) : "";
  const isDoorFirst = random.chance(0.4);
  const waits = how.waits || door?.waits || kind === "async";
  const act = [
    before,
    change,
    isDoorFirst ? other : "",
    how.write(expression, n),
    isDoorFirst ? "" : other,
    later,
    waits ? "await pause();" : "",
    `tell(${JSON.stringify(`${n} ${kind}`)});`,
  ]
    .filter(line => line !== "")
    .join("\n");
  const where = random.weighted([[4, "top"], [2, "function"], [1, "function twice"], [1, "loop"]] as const); // prettier-ignore
  const isInside = random.chance(0.3) && declared !== "";
  const whole = isInside ? `${declared}\n${act}` : act;
  const asynchronous = waits ? "async " : "";
  const awaited = waits ? "await " : "";
  return `${isInside ? "" : declared ? declared + "\n" : ""}${
    where === "top" ? `{\n${whole}\n}`
    : where === "loop" ? `for (let turn = 0; turn < 40; turn++) {\n  quiet = turn > 0 && turn < 39;\n${whole}\n}`
    : `${asynchronous}function act${n}() {\n${whole}\n}\n${awaited}act${n}();${where === "function twice" ? `\n${awaited}act${n}();` : ""}`
  }`; // prettier-ignore
}

export function generate(random: Random): string {
  return (
    [prelude, ...Array.from({ length: random.between(2, 6) }, (_, index) => scene(random, index))].join("\n") + "\n"
  );
}
