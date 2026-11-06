// Small programs about one instance and one change to an object above it. A member of the instance is made by a field, which defines it, or by a store, which asks the objects above first; the change
// puts an accessor, a member that cannot be written, a proxy or another object above the instance, or takes something away. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the instance  of a class, of a class below a class, of a function, a literal with `__proto__`, what `Object.create` makes
//   its member    a field, a field of the class above, a store in the constructor, a store in the constructor above, `Object.assign(this, ..)`, or none until the program stores it
//   from the start  the class above has nothing, a setter, a getter and a setter, a field, or a store of that name
//   the change    an accessor, a setter alone, a getter alone, a member that cannot be written, a plain member, `delete`, `freeze`, another object above, `null` above, a proxy above, a method
//                 replaced, another prototype for the instance; `toJSON`, `toString`, `valueOf`, `Symbol.toPrimitive`, `Symbol.iterator`, `Symbol.toStringTag`
//   made to       the `prototype` of the class, of the class above, what `Object.getPrototypeOf`, `__proto__` and `constructor.prototype` answer for the instance
//   when          ahead of the making, inside the constructor above, behind the making, behind the first store, on the second of three turns
//   then          reads, stores of every form, `delete`, `in`, `hasOwn`, keys, `for in`, JSON, conversions, a spread, the method; a second instance; what the accessors and traps were asked
import type { Random } from "./random";

export function generate(random: Random): string {
  const n = random.pick(["x", "x", "x", "y", "0"]);
  const dot = n === "0" ? "[0]" : `.${n}`;
  const value = () => random.pick(["1", "2", "7", "1.5", '"t"', "null", "undefined", "true"]);
  const getter = `get ${n}() {\nlog += "get ";\nreturn "got";\n}`;
  const setter = `set ${n}(given) {\nlog += "set ";\n}`;
  const kind = random.weighted([
    [5, "below a class"],
    [3, "a class"],
    [2, "a function"],
    [2, "a literal"],
    [1, "created"],
  ] as const);
  // Plain Bun lets `Object.assign` add an element under an index whatever stands above, so it takes names alone here.
  const born = random.pick([
    "a field",
    "a field",
    "a store",
    "a store",
    n === "0" ? "a store" : "assigned",
    "nothing",
  ] as const);
  const birth = (where: "field" | "constructor") =>
    where === "field"
      ? born === "a field"
        ? `${n === "0" ? "[0]" : n} = ${value()};\n`
        : ""
      : born === "a store"
        ? `this${dot} = ${value()};\n`
        : born === "assigned"
          ? `Object.assign(this, { ${n}: ${value()} });\n`
          : "";
  const method = random.chance(0.5) ? `tells() {\nreturn "told " + this${dot};\n}\n` : "";
  const bornAbove = kind === "below a class" && random.chance(0.3);
  const start = random.pick([
    "",
    "",
    setter,
    `${getter}\n${setter}`,
    `${n === "0" ? "[0]" : n} = "of the class above";`,
    "a store",
  ]);
  const when = random.pick([
    "ahead",
    "ahead",
    "inside",
    "behind the making",
    "behind the making",
    "behind the store",
    "the second turn",
  ] as const);
  const inside = when === "inside" && kind === "below a class";

  const P = random.pick(
    when === "ahead" || inside || when === "the second turn"
      ? kind === "below a class"
        ? ["K.prototype", "Above.prototype", "Above.prototype"]
        : kind === "a literal" || kind === "created"
          ? ["above"]
          : ["K.prototype"]
      : [
          "Object.getPrototypeOf(o)",
          "o.__proto__",
          ...(kind === "a literal" || kind === "created" ? ["above"] : ["o.constructor.prototype", "K.prototype"]),
          ...(kind === "below a class" ? ["Above.prototype", "Above.prototype"] : []),
        ],
  );
  const key = n === "0" ? "0" : `"${n}"`;
  const traps = `new Proxy(\n{},\n{\nget(target, name) {\nlog += "asked " + String(name) + " ";\nreturn undefined;\n},\nset(target, name, given, receiver) {\nlog += "stores " + String(name) + " ";\nreturn Reflect.defineProperty(receiver, name, { value: given, writable: true, enumerable: true, configurable: true });\n},\nhas(target, name) {\nlog += "has " + String(name) + " ";\nreturn false;\n},\n},\n)`;
  const change = random.weighted<string>([
    [
      4,
      `Object.defineProperty(${P}, ${key}, {\nget() {\nlog += "get ";\nreturn "got";\n},\nset(given) {\nlog += "set ";\n},\nconfigurable: true,\n});`,
    ],
    [3, `Object.defineProperty(${P}, ${key}, {\nset(given) {\nlog += "set ";\n},\nconfigurable: true,\n});`],
    [2, `Object.defineProperty(${P}, ${key}, {\nget() {\nlog += "get ";\nreturn "got";\n},\nconfigurable: true,\n});`],
    [3, `Object.defineProperty(${P}, ${key}, { value: "fixed", writable: false, configurable: true });`],
    [2, `${P}${dot} = "above";`],
    [2, `delete ${P}${dot};`],
    [3, `Object.freeze(${P});`],
    [2, `Object.setPrototypeOf(${P}, {\n${getter},\n${setter},\n});`],
    [1, `Object.setPrototypeOf(${P}, null);`],
    [3, `Object.setPrototypeOf(${P}, ${traps});`],
    [2, `${P}.tells = function () {\nreturn "replaced " + this${dot};\n};`],
    [1, `delete ${P}.tells;`],
    ...(when === "ahead" || inside
      ? []
      : ([
          [2, `Object.setPrototypeOf(o, {\n${getter},\n${setter},\n});`],
          [1, `Object.setPrototypeOf(o, null);`],
          [1, `Object.setPrototypeOf(o, ${traps});`],
        ] as [number, string][])),
    [1, `${P}.toJSON = function () {\nreturn "as json";\n};`],
    [1, `${P}.toString = function () {\nreturn "as text";\n};`],
    [1, `${P}.valueOf = function () {\nreturn 42;\n};`],
    [1, `${P}[Symbol.toPrimitive] = function () {\nreturn "primitive";\n};`],
    [1, `${P}[Symbol.iterator] = function* () {\nyield this${dot};\n};`],
    [1, `Object.defineProperty(${P}, Symbol.toStringTag, { value: "Tagged", configurable: true });`],
  ]);

  const aboveBody = `${start === "a store" ? "" : start ? start + "\n" : ""}${bornAbove ? birth("field") : ""}${
    start === "a store" || inside || (bornAbove && birth("constructor"))
      ? `constructor() {\n${start === "a store" ? `this${dot} = "stored above";\n` : ""}${inside ? change + "\n" : ""}${bornAbove ? birth("constructor") : ""}}\n`
      : ""
  }`;
  const ownConstructor = (isBelow: boolean) =>
    birth("constructor") ? `constructor() {\n${isBelow ? "super();\n" : ""}${birth("constructor")}}\n` : "";
  const declared = {
    "below a class": `class Above {\n${aboveBody}}\nclass K extends Above {\n${bornAbove ? "" : birth("field") + ownConstructor(true)}${method}}`,
    "a class": `class K {\n${birth("field")}${ownConstructor(false)}${method}}`,
    "a function": `function K() {\n${born === "nothing" ? "" : `this${dot} = ${value()};\n`}}${method ? `\nK.prototype.tells = function () {\nreturn "told " + this${dot};\n};` : ""}`,
    "a literal": `const above = {\n${start && start !== "a store" && !start.includes("=") ? start + ",\n" : ""}${method.replace(/}\n$/, "},\n")}};`,
    created: `const above = {\n${start && start !== "a store" && !start.includes("=") ? start + ",\n" : ""}${method.replace(/}\n$/, "},\n")}};`,
  }[kind].replace(/\{\n\}/g, "{}");
  const make = {
    "below a class": "new K()",
    "a class": "new K()",
    "a function": "new K()",
    "a literal": born === "nothing" ? "{ __proto__: above }" : `{ __proto__: above, ${n}: ${value()} }`,
    created:
      born === "nothing"
        ? "Object.create(above)"
        : n === "0"
          ? `Object.create(above, { 0: { value: ${value()}, writable: true, enumerable: true, configurable: true } })`
          : `Object.assign(Object.create(above), { ${n}: ${value()} })`,
  }[kind];

  const store = () =>
    random.pick([
      `o${dot} = ${value()};`,
      `o${dot} = ${value()};`,
      `o${dot} = ${value()};`,
      `o[${key}] = ${value()};`,
      `o${dot} += 1;`,
      `o${dot}++;`,
      n === "0" ? `o${dot} = ${value()};` : `Object.assign(o, { ${n}: ${value()} });`,
      `({ a: o${dot} } = { a: ${value()} });`,
      `[o${dot}] = [${value()}];`,
      `console.log(Reflect.set(o, ${key}, ${value()}));`,
      `Object.defineProperty(o, ${key}, { value: ${value()}, writable: true, enumerable: true, configurable: true });`,
      `o${dot} ??= ${value()};`,
      `console.log(delete o${dot});`,
      `for (o${dot} of [${value()}]);`,
    ]);
  const read = () =>
    random.pick([
      `console.log(o${dot});`,
      `console.log(o${dot});`,
      `console.log(o${dot}, Object.hasOwn(o, ${key}), ${key} in o);`,
      `console.log(Object.keys(o).join());`,
      `console.log(JSON.stringify(o));`,
      `for (const each in o) console.log(each);`,
      `console.log(typeof o.tells === "function" ? o.tells() : "no method");`,
      "console.log(`${o}`);",
      `console.log(o + "");`,
      `console.log(Object.prototype.toString.call(o));`,
      `console.log(Object.keys({ ...o }).join());`,
      `console.log(JSON.stringify(Object.getOwnPropertyDescriptor(o, ${key})));`,
      `console.log([...o].length);`,
      `{\nconst { ${n}: taken } = o;\nconsole.log(taken);\n}`,
    ]);
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const each = random.chance(0.4);
  const step = (text: string) => (each ? guarded(text) : text);
  const steps = (isTurn: boolean) =>
    [
      when === "ahead" ? step(change) : "",
      `const o = ${make};`,
      random.chance(0.4) ? step(read()) : "",
      when === "behind the making" ? step(change) : "",
      isTurn ? `if (turn === 1) {\n${change}\n}` : "",
      step(store()),
      when === "behind the store" ? step(change) : "",
      step(read()),
      random.chance(0.5) ? step(read()) : "",
      random.chance(0.3) ? step(store()) + "\n" + step(read()) : "",
      random.chance(0.3)
        ? step(`{\nconst second = ${make};\nconsole.log(second${dot}, Object.keys(second).join());\n}`)
        : "",
      `console.log(log);`,
    ]
      .filter(Boolean)
      .join("\n");
  const scene = when === "the second turn" ? `for (let turn = 0; turn < 3; turn++) {\n${steps(true)}\n}` : steps(false);
  // The handler stands round the scene, or round the call of the function that holds the scene, which then has none.
  const place = random.pick(["top", "top", "once", "once", "thrice", "generator", "method"] as const);
  const head = `let log = "";\n${declared}`;
  if (place === "top") return `${head}\n${guarded(scene)}\n`;
  const called = guarded;
  if (place === "once") return `${head}\nfunction run() {\n${scene}\n}\n${called("run();")}\n`;
  if (place === "thrice") return `${head}\nfunction run() {\n${scene}\n}\n${called("run();\nrun();\nrun();")}\n`;
  if (place === "generator")
    return `${head}\nfunction* run() {\nyield 1;\n${scene}\n}\n${called(`for (const step of run()) console.log("step", step);`)}\n`;
  return `${head}\nconst holder = {\nrun() {\n${scene}\n},\n};\n${called("holder.run();")}\n`;
}
