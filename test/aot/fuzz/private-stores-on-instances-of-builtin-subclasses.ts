// A class that extends a built-in class stores under a private name, again and again. Its instances are objects of the
// built-in class, so the field lies wherever the object's present shape puts it, and a fast store has to find it there. Each
// scene picks the parent, who makes the object, the kind of store and of value, and what happens to the object between two
// stores: properties come and go, it is frozen, it gets another prototype, a collection runs. Objects that lack the name also
// come by: of another evaluation of the class, of the parent, a plain one. After every store the field is read back.
// In half of the scenes the loops stand in the class's own methods.
import type { Random } from "./random";

/** Parents, with the arguments of their constructors. */
const parents: [name: string, args: string][] = [
  ["Array", ""],
  ["Array", "3"],
  ["Map", ""],
  ["Set", ""],
  ["WeakMap", ""],
  ["Error", '"e"'],
  ["TypeError", '"e"'],
  ["Promise", "() => {}"],
  ["RegExp", '"a"'],
  ["Date", "0"],
  ["Uint8Array", "2"],
  ["Float64Array", "2"],
  ["ArrayBuffer", "8"],
  ["DataView", "new ArrayBuffer(8)"],
  ["Function", ""],
  ["Number", "5"],
  ["String", '"text"'],
  ["Boolean", "true"],
  ["Object", ""],
  ["Event", '"e"'],
  ["EventTarget", ""],
  ["URL", '"http://a/"'],
  ["Headers", ""],
  ["Blob", ""],
  ["AbortController", ""],
  ["Buffer", "2"],
];

/** Expressions that make an object that has the name. C is the class, ARGS its arguments. */
const makers = [
  "new C(ARGS)",
  "new C(ARGS)",
  "new C(ARGS)",
  "Reflect.construct(C, [ARGS])",
  "Reflect.construct(C, [ARGS], Other)",
  "new (class extends C {})(ARGS)",
  'new (class extends C {\n    #p = "a name of its own";\n    extra = 1;\n  })(ARGS)',
  "Object.assign(new C(ARGS), { early: 1 })",
];

/** Method bodies that store VALUE under the name on `it`. */
const stores = [
  "it.#p = VALUE;",
  "it.#p = VALUE;",
  "it.#p = VALUE;",
  "it.#p += 1;",
  "it.#p++;",
  "it.#p ??= VALUE;",
  "it.#p ||= VALUE;",
  "[it.#p] = [VALUE];",
  "({ a: it.#p } = { a: VALUE });",
  "for (it.#p of [VALUE]);",
  "it.#p = VALUE;\n    it.#q = it.#p;",
  "it.#q = VALUE;\n    it.#p = it.#q;",
];

const values = [
  "i",
  "i + 0.5",
  '"text" + i',
  "{ n: i }",
  "[i]",
  "undefined",
  "null",
  "it",
  "() => i",
  "BigInt(i)",
  'i % 2 ? i : "text"',
];

/** Statements that change `it` between two stores. */
const changes = [
  "",
  "",
  'it["added" + i] = i;',
  "it.added = i;",
  "it.added = i;\n      delete it.added;",
  "delete it.early;",
  "if (i === 2) Object.freeze(it);",
  "if (i === 2) Object.seal(it);",
  "if (i === 2) Object.preventExtensions(it);",
  "if (i === 2) Object.setPrototypeOf(it, Other.prototype);",
  "if (i === 2) Object.setPrototypeOf(it, null);",
  'if (i === 2) for (let n = 0; n < 80; n++) it["many" + n] = n;',
  'if (i === 2) Object.defineProperty(it, "p", { get: () => "not the private one", configurable: true });',
  "if (i % 50 === 2) Bun.gc(true);",
  "it[i] = i;",
  'it[Symbol.for("s")] = i;',
];

/** Expressions for an object that lacks the name, or has that of another class. */
const strangers = [
  "new Parent(ARGS)",
  "{}",
  "null",
  "5",
  "new (make())(ARGS)",
  "Object.create(C.prototype)",
  "new Proxy(first, {})",
  "C",
  "C.prototype",
  "stamped({})",
  "stamped(new Parent(ARGS))",
  "stamped(Object.freeze({}))",
];

/** Other declarations of the name. A store then calls a setter, or is refused. */
const members = [
  "#p = 0;",
  "#p = 0;",
  "#p = 0;",
  "#p;",
  "#held = 0;\n    set #p(value) {\n      this.#held = value;\n    }\n    get #p() {\n      return this.#held;\n    }",
  "get #p() {\n      return 1;\n    }",
  "#p() {}",
  "static #p = 0;",
];

/** What TypeScript wants behind the name of a generic parent. */
const typeParameters: Record<string, string> = { Array: "<any>", Map: "<any, any>", Set: "<any>", WeakMap: "<object, any>", Promise: "<any>" }; // prettier-ignore

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    // TypeScript wants other arguments for a class below a view.
    const [parent, args] = random.pick(
      typed ? parents.filter(([name]) => !/8Array|64Array|DataView/.test(name)) : parents,
    );
    const filled = (text: string) => text.replaceAll("ARGS", args);
    const value = random.pick(values);
    const turns = random.pick([3, 5, 300]);
    // Half of the scenes are plain: the class stands at the top of the file, its methods hold the loops, and the objects reach
    // them without a helper in between. There the compiler knows the receiver and takes the code for hot.
    if (typed || random.chance(0.5)) {
      // In TypeScript the object is changed through a variable without a type, and the parent's type parameters are written.
      const change = random.pick(changes).replaceAll("\n      ", "\n    ").replace(/\bit\b/g, "raw").replaceAll("Other.prototype", "Object.prototype"); // prettier-ignore
      const above = parent + (typed ? (typeParameters[parent] ?? "") : "");
      const member = random.pick(members.slice(0, 5)).replaceAll("\n    ", "\n  ");
      const name = `Plain${scene}`;
      const stranger = filled(random.pick(["new Parent(ARGS)", "{}", "null", "Plain.prototype"])).replace("Parent", parent).replace("Plain", name); // prettier-ignore
      scenes.push(`class ${name} extends ${above} {
  ${typed ? member.replace("#p = 0;", "#p: any = 0;").replace("#p;", "#p: any;").replace("#held = 0;", "#held: any = 0;").replace("(value)", "(value: any)") : member}
  #q${as("any")} = 0;
  spin(turns${as("number")})${as("string")} {
    const it = this;
    for (let i = 0; i < turns; i++) {
    ${random.pick(stores).replaceAll("VALUE", value)}
    }
    return shown(this.#p) + "," + shown(this.#q);
  }
  static each(list${as(`${name}[]`)})${as("string")} {
    let seen = "";
    for (const it of list) seen += shown(it.#p) + ";";
    return seen;
  }
  static fill(list${as(`${name}[]`)})${as("number")} {
    for (let i = 0; i < list.length; i++) list[i].#q = i;
    return list.length;
  }
}
function plain${scene}()${as("string")} {
  const it = new ${name}(${args});
  const raw${as("any")} = it;
  const before = it.spin(${turns});
  for (let i = 0; i < 4; i++) {
    ${change}
  }
  const list = [it, new ${name}(${args}), new ${name}(${args})];
  return [before, it.spin(${turns}), ${name}.fill(list), ${name}.each(list), list[2].spin(2)].join(" | ");
}
console.log("scene ${scene} plain", told(plain${scene}));
console.log("scene ${scene} stranger", told(() => ${name}.each([${typed ? `(${stranger}) as any` : stranger}])));`);
      continue;
    }
    scenes.push(`{
  const Parent = ${parent};
  const make = () =>
    class extends Parent {
    ${random.pick(members)}
    #q = 0;
    static store(it, i) {
    ${random.pick(stores).replaceAll("VALUE", value)}
    }
    static read(it) {
      return shown(it.#p) + "," + shown(it.#q);
    }
    static has(it) {
      return #q in it;
    }
  };
  const C = make();
  function Other() {}
  Other.prototype.other = true;
  // The parent hands back what it was given, so the fields of this class are put on a foreign object.
  const stamped = it =>
    new (class extends function (given) {
      return given;
    } {
      #p = "stamped by another class";
    })(it);
  const first = told(() => ${filled(random.pick(makers))});
  const second = told(() => ${filled(random.pick(makers))});
  for (const it of [first, second]) {
    let last = "";
    for (let i = 0; i < ${turns}; i++) {
      told(() => {
      ${random.pick(changes)}
      });
      last = noted(told(() => (C.store(it, i), C.read(it))).replaceAll(String(i), "i"));
    }
    console.log("scene ${scene}", last, counted(), told(() => C.has(it)), told(() => Object.keys(it).length));
  }
  for (const stranger of [() => ${random.sample(strangers, random.between(1, 3)).map(filled).join(", () => ")}]) {
    console.log("scene ${scene} stranger", told(() => (C.store(stranger(), 1), "stored")), told(() => C.read(stranger())), told(() => C.has(stranger())));
  }
  console.log("scene ${scene} again", told(() => (C.store(first, 7), C.read(first))));
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
function shown(value${as("any")})${as("string")} {
  if (typeof value === "function") return "function";
  if (typeof value === "bigint") return value + "n";
  if (value === null || typeof value !== "object") return typeof value + " " + String(value);
  return Array.isArray(value) ? "list " + value.length : "n" in value ? "object " + value.n : "object";
}
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
