// Something throws while a class is defined or first used, and the program goes on with what stood around the class. A program is one scene, made of
//   a site      where it throws: a static block, a static or an instance field, a computed key, the heritage, a decorator, a getter, a constructor before or after super()
//   a throw     an undeclared name, a binding in its dead zone, a call of what is no function, a thrown value
//   a catch     a try block round the class, one at the site, one in the caller, or none
//   a thing     that a function at the site captures and that is shown afterwards: a variable declared with `!` and never assigned, `this`, a value read from a list,
//               the binding of the class
//   types       that fit, types that do not (the list is declared as an interface), or none
//   whether the function that captures is called
// One scene a program: what the compiler learns about one class says nothing about another.
import type { Random } from "./random";

export const sites = [
  "static block",
  "static field",
  "instance field",
  "computed key",
  "heritage",
  "decorator",
  "getter",
  "before super",
  "after super",
] as const;
export const throws = ["undeclared", "dead zone", "not callable", "thrown value"] as const;
export const catches = ["round", "inside", "caller", "none"] as const;
export const things = ["unassigned", "this", "read", "class"] as const;
export const typings = ["right", "wrong", "untyped"] as const;
export const calls = [false, true] as const;

export type Scene = {
  site: (typeof sites)[number];
  thrown: (typeof throws)[number];
  caught: (typeof catches)[number];
  thing: (typeof things)[number];
  typing: (typeof typings)[number];
  isCalled: boolean;
};

export function write({ site, thrown, caught, thing, typing, isCalled }: Scene): { file: string; text: string } {
  const isTyped = typing !== "untyped";
  const typed = (text: string) => (isTyped ? text : "");
  const any = (text: string) => (isTyped ? `(${text} as any)` : text);
  const ignore = isTyped ? "// @ts-ignore\n" : "";
  const listType = typing === "wrong" ? "Holder" : "(string | undefined)[]";

  const head = `function passThroughMap${typed("<V>")}(value${typed(": V")})${typed(": V")} {
  const map = new Map${typed("<string, V>")}();
  map.set("key", value);
  return map.get("key")${typed("!")};
}
function classOf(error${typed(": unknown")}) {
  return error instanceof Error ? error.constructor.name : typeof error + " " + String(error);
}
function show(label${typed(": string")}, value${typed(": unknown")}) {
  console.log(label, typeof value, typeof value === "function" ? value.name : typeof value === "object" ? JSON.stringify(value) : String(value));
}
function fail()${typed(": any")} {
  throw "thrown";
}
function take(value${typed(": unknown")}) {
  return value;
}
${typed("interface Holder {\n  value: string[];\n}\n")}const notCallable = 5;
const kept${typed(": (() => unknown)[]")} = [];
function keep(look${typed(": () => unknown")}) {
  ${isCalled ? "kept.push(look);" : ""}
  return 0;
}
class Base {}
`;

  const thrower = {
    "undeclared": any("undeclared"),
    "dead zone": any("later"),
    "not callable": `${any("notCallable")}()`,
    "thrown value": "fail()",
  }[thrown];
  const captured = { unassigned: "unassigned", this: "this", read: "read", class: "Made" }[thing];
  const fallback = site === "heritage" ? "Base" : site === "decorator" ? `${any("(made) => made")}` : '"fallback"';
  let expression = `(keep(() => ${captured}), ${thrower})`;
  let statement = `keep(() => ${captured});\n${ignore}take(${thrower});`;
  if (caught === "inside") {
    expression = `(() => {\n  try {\n    ${ignore}return ${expression};\n  } catch (error) {\n    console.log("inside:", classOf(error));\n    return ${fallback};\n  }\n})()`;
    statement = `try {\n${statement}\n} catch (error) {\n  console.log("inside:", classOf(error));\n}`;
  }

  const [definition, use] = {
    "static block": [`class Made {\n  static {\n${statement}\n  }\n}`, `show("defined", Made);`],
    "static field": [`class Made {\n  ${ignore}static at = ${expression};\n}`, `show("field", Made.at);`],
    "instance field": [`class Made {\n  ${ignore}at = ${expression};\n}`, `show("field", new Made().at);`],
    "computed key": [`class Made {\n  ${ignore}[${expression}]() {}\n}`, `show("defined", Made);`],
    "heritage": [`${ignore}class Made extends ${expression} {}`, `show("made", new Made());`],
    "decorator": [`${ignore}@(${expression})\nclass Made {}`, `show("defined", Made);`],
    "getter": [`class Made {\n  get at() {\n${statement}\n    return 1;\n  }\n}`, `show("got", new Made().at);`],
    "before super": [
      `class Made extends Base {\n  constructor() {\n${thing === "this" ? statement.replace("() => this", "() => new.target") : statement}\n    super();\n  }\n}`,
      `show("made", new Made());`,
    ],
    "after super": [
      `class Made extends Base {\n  constructor() {\n    super();\n${statement}\n  }\n}`,
      `show("made", new Made());`,
    ],
  }[site];

  const list =
    thing === "read"
      ? `const list${typed(": " + listType)} = passThroughMap${typed(`<${listType}>`)}(${typing === "wrong" ? any('[undefined, "b"]') : '[undefined, "b"]'});\nconst read = ${any("list")}[1];\n`
      : "";
  const inner = `${list}${definition}\n${use}\nheld = Made;`;
  const guarded =
    caught === "round" ? `try {\n${inner}\n} catch (error) {\n  console.log("round:", classOf(error));\n}` : inner;
  const after = {
    unassigned: `show("after", unassigned);`,
    this: `show("after", ${caught === "caller" ? "typeof this" : "this"});`,
    read: `show("after", held);`,
    class: `show("after", held);`,
  }[thing];
  const declarations = `let unassigned${typed("!: number[]")};\nlet held${typed(": unknown")};\n`;
  const deadZone = thrown === "dead zone" ? `\nlet later = 1;\nshow("later", later);` : "";
  const scene =
    caught === "caller"
      ? `function define() {\n${guarded}${deadZone}\n}\ntry {\n  define();\n} catch (error) {\n  console.log("caller:", classOf(error));\n}`
      : `${guarded}${deadZone}`;
  const tail = `for (const look of kept) {\n  try {\n    show("look", look());\n  } catch (error) {\n    console.log("look:", classOf(error));\n  }\n}\nconsole.log("end");\n`;
  return { file: isTyped ? "main.ts" : "main.js", text: `${head}${declarations}${scene}\n${after}\n${tail}` };
}

// A decorator names no `this`.
export const isWritten = (scene: Scene) => scene.site !== "decorator" || scene.thing !== "this";

export function sceneAt(index: number): Scene {
  const take = <T>(items: readonly T[]): T => {
    const item = items[index % items.length];
    index = Math.floor(index / items.length);
    return item;
  };
  return {
    site: take(sites),
    thrown: take(throws),
    caught: take(catches),
    thing: take(things),
    typing: take(typings),
    isCalled: take(calls),
  };
}

export const numberOfScenes =
  sites.length * throws.length * catches.length * things.length * typings.length * calls.length;

// A scene with types, for whoever takes TypeScript alone.
export function generate(random: Random): string {
  for (;;) {
    const scene: Scene = { ...sceneAt(random.below(numberOfScenes)), typing: random.pick(["right", "wrong"]) };
    if (isWritten(scene)) return write(scene).text;
  }
}
