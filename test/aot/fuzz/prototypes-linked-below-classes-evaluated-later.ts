// A constructor function, and classes below it, are defined, handed out and used first. Only later does the program evaluate
// another class, and then it links the function's prototype below that class's prototype. A compiler that foresees the link
// must not act on the later class before the program has evaluated it. Each scene picks what the later class extends (a host
// class, a class of the language, a class of the program, nothing), what stands between, how the link is made, where the
// later class is evaluated (a later statement, a function called later, behind a condition, twice) and what is asked: a
// method through the new link, instanceof, the identity of the class object, the names on the way up.
import type { Random } from "./random";

/** What the later class extends, and the arguments its constructor takes. */
const parents: [name: string, args: string][] = [
  ["Event", '"e"'],
  ["CustomEvent", '"e"'],
  ["EventTarget", ""],
  ["URL", '"http://a/"'],
  ["URLSearchParams", ""],
  ["Blob", ""],
  ["File", '[], "f"'],
  ["Headers", ""],
  ["Request", '"http://a/"'],
  ["Response", ""],
  ["AbortController", ""],
  ["TextDecoder", ""],
  ["TextEncoder", ""],
  ["FormData", ""],
  ["ReadableStream", ""],
  ["WritableStream", ""],
  ["TransformStream", ""],
  ["MessageChannel", ""],
  ["DOMException", ""],
  ["Buffer", "2"],
  ["Error", '"e"'],
  ["TypeError", '"e"'],
  ["Map", ""],
  ["Set", ""],
  ["Array", ""],
  ["Promise", "() => {}"],
  ["Date", "0"],
  ["RegExp", '"a"'],
  ["Uint8Array", "2"],
  ["Object", ""],
  ["Own", ""],
  ["OwnFunction", ""],
  ["", ""],
];

/** What is defined and used first. Each ends with `first`, an object made before the later class exists. */
const lowers = [
  "function Emitter() {}\n  class Interface extends Emitter {}\n  const Lowest = Interface;",
  "function Emitter() {}\n  const Lowest = Emitter;",
  "function Emitter() {}\n  class Interface extends Emitter {}\n  class Below extends Interface {}\n  const Lowest = Below;",
  "function Emitter() {}\n  function Middle() {}\n  Object.setPrototypeOf(Middle.prototype, Emitter.prototype);\n  class Interface extends Middle {}\n  const Lowest = Interface;",
  "class Emitter {}\n  class Interface extends Emitter {}\n  const Lowest = Interface;",
  'function Emitter() {}\n  Emitter.prototype.own = () => "own";\n  class Interface extends Emitter {\n    field = 1;\n    method() {\n      return "method";\n    }\n  }\n  const Lowest = Interface;',
  "const Emitter = function () {};\n  const Lowest = class extends Emitter {};",
];

/** How the function and the first object leave the compiler's sight, or do not. */
const escapes = [
  "",
  "globalThis.handedOut = Emitter;\n  globalThis.alsoHandedOut = first;",
  "kept.push(Emitter, first);",
  "hide(Emitter);",
  'globalThis[key("handedOut")] = first;',
];

/** Statements that evaluate the later class as `Base`. CLASS is the class expression. */
const evaluations = [
  "const Base = CLASS;",
  "const Base = CLASS;",
  "const Base = (() => CLASS)();",
  "const make = () => CLASS;\n  const Base = make();",
  "const make = () => CLASS;\n  make();\n  const Base = make();",
  'let Base;\n  if (key("yes") === "yes") Base = CLASS;\n  else Base = class {};',
  "let Base;\n  for (let turn = 0; turn < 2; turn++) Base = CLASS;",
  "const holder = { Base: CLASS };\n  const { Base } = holder;",
];

/** Statements that link `Emitter.prototype` below `Base.prototype`. */
const links = [
  "Object.setPrototypeOf(Emitter.prototype, Base.prototype);",
  "Object.setPrototypeOf(Emitter.prototype, Base.prototype);",
  "Reflect.setPrototypeOf(Emitter.prototype, Base.prototype);",
  "Emitter.prototype.__proto__ = Base.prototype;",
  "Object.setPrototypeOf(hide(Emitter).prototype, hide(Base.prototype));",
  "Object.setPrototypeOf(Emitter.prototype, Base.prototype);\n  Object.setPrototypeOf(Emitter, Base);",
  "Object.setPrototypeOf(Object.getPrototypeOf(first), Base.prototype);",
  "Object.setPrototypeOf(first, Base.prototype);",
  "Emitter.prototype = Object.create(Base.prototype);",
  "Object.setPrototypeOf(Emitter.prototype, Object.create(Base.prototype));",
  "",
];

const looks = [
  "first.greet()",
  "new Lowest().greet()",
  "first instanceof Base",
  "new Lowest() instanceof Base",
  "typeof Base",
  "Base === Base.prototype.constructor",
  "Base.name",
  "new Base(ARGS) instanceof Base",
  "new Base(ARGS).greet()",
  "chain(first)",
  "chain(new Lowest())",
  "Object.getPrototypeOf(Base) === PARENT",
  "first.constructor === Lowest",
  '"greet" in first',
  "Base.prototype.isPrototypeOf(first)",
  "Reflect.construct(Base, [ARGS], Lowest) instanceof Lowest",
  "Object.keys(first).join()",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const [parent, args] = random.pick(parents);
    const written = `class ${random.chance(0.5) ? "Named " : ""}${parent ? `extends ${parent} ` : ""}{\n    greet() {\n      return "greet";\n    }\n  }`;
    const asked = random
      .sample(looks, random.between(3, 6))
      .map(look => look.replaceAll("ARGS", args).replaceAll("PARENT", parent || "Function.prototype"));
    const early = random.pick([
      "",
      "",
      "told(() => first.greet?.());",
      "for (let i = 0; i < 300; i++) new Lowest();",
      'told(() => "greet" in first);',
    ]);
    // Each scene has names of its own: a bundler renames what two blocks declare alike, and the names are printed. The
    // function is named twice at least, or plain Bun puts it where its one use stands and it takes that variable's name.
    const text = `{
  ${random.pick(lowers)}
  kept.push(typeof Emitter);
  const first = new Lowest();
  ${random.pick(escapes)}
  ${early}
  ${random.pick(evaluations).replaceAll("CLASS", () => written)}
  told(() => {
  ${random.pick(links)}
  });
  console.log("scene ${scene}", [${asked.map(look => `told(() => ${look})`).join(", ")}].join(" | "));
}`;
    scenes.push(text.replace(/\b(Emitter|Interface|Below|Middle|Lowest|Base|Named)\b/g, `$1${scene}`));
  }
  const modules = random.chance(0.3) ? random.sample(["readline", "stream", "events"], random.between(1, 2)).map(name => `import "node:${name}";\n`).join("") : ""; // prettier-ignore
  return `${modules}const key = name => process.argv[9] ?? name;
const kept = [];
const hide = new Function("value", process.argv[9] ?? "return value");
class Own {
  ownMethod() {
    return "own";
  }
}
function OwnFunction() {}
function chain(it) {
  const names = [];
  for (let at = Object.getPrototypeOf(it); at && names.length < 9; at = Object.getPrototypeOf(at)) names.push(at.constructor?.name || "nameless");
  return names.join("<");
}
function told(ask) {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
