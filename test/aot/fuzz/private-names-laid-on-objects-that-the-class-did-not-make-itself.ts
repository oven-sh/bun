// Small programs about one class with private names whose instances are made by something else: a built-in class above it, or a class above that hands back an object it was given. A few instances are
// made in a row, and one of them is odd. Each object gets the private names of the class once; a second time is refused, and so is a read on an object that never got them. There is one scene, and
// every line is printed at once, by `console.log` itself.
//
//   the class above  `Promise`, `Map`, `Set`, `Error`, `Array`, `Date`, `RegExp`, `Uint8Array`, `Object`, a class or a function that hands back what it is given, an heir of one of these
//   the names        one to seventeen private fields, a private method, a private accessor, a static test with `in`
//   in a row         one to six makings in a loop or written out
//   the odd one      the same object a second time, a frozen object, a sealed one, a proxy, a list, a function, an object without a prototype, one with many members, an instance of another
//                    built-in class, a class below the class, another new target, another class above from that turn on
//   then             the fields are read, stored to and read, tested with `in`, the method is called, on each object and on one that never got the names; what the object is besides
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const above = random.weighted([
    [6, "Hands"],
    [2, "hands"],
    [3, "Promise"],
    [3, "Map"],
    [3, "Set"],
    [3, "Error"],
    [3, "Array"],
    [1, "Date"],
    [1, "RegExp"],
    [1, "Uint8Array"],
    [1, "Object"],
    [2, "Between"],
  ] as const);
  const handsBack = above === "Hands" || above === "hands";
  const count = random.pick([1, 1, 2, 3, 5, 9, 17]);
  const fields = Array.from(
    { length: count },
    (_, index) => `#f${index} = ${random.pick([`${index}`, `"t${index}"`, `${index}.5`, "null", `[${index}]`])};`,
  );
  const hasMethod = random.chance(0.4);
  const hasAccessor = random.chance(0.25);
  const last = `#f${count - 1}`;
  const given = above === "Promise" ? "() => {}" : "";
  const declaredAbove = {
    Hands: "class Hands {\nconstructor(given) {\nreturn given;\n}\n}",
    hands: "function hands(given) {\nreturn given;\n}",
    Between: `class Between extends ${random.pick(["Map", "Set", "Promise", "Array"])} {\n#own = "between";\n}`,
  }[above as string];
  const isBetweenAPromise = declaredAbove?.includes("extends Promise") ?? false;
  const K = [
    `class K extends ${above} {`,
    ...fields,
    hasMethod ? '#m() {\nreturn "m";\n}' : "",
    hasAccessor ? "get #g() {\nreturn this.#f0;\n}" : "",
    "static has(o) {\nreturn #f0 in o;\n}",
    `read() {\nreturn String(this.#f0) + " " + String(this.${last})${hasMethod ? " + this.#m()" : ""}${hasAccessor ? ' + " " + String(this.#g)' : ""};\n}`,
    `put(given) {\nthis.${last} = given;\n}`,
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const argument = above === "Promise" || isBetweenAPromise ? "() => {}" : above === "Date" ? "0" : given;
  const ordinary = handsBack ? random.pick(["{}", "{}", "{ x: 1 }", "{ x: turn }"]) : argument;
  const turns = random.pick([1, 2, 3, 3, 4, 6]);
  const at = random.below(turns);
  const odd = handsBack
    ? random.weighted<string>([
        [4, "new K(all[0] ?? {})"],
        [3, "new K(Object.freeze({}))"],
        [1, "new K(Object.seal({ x: 1 }))"],
        [1, "new K(Object.preventExtensions({}))"],
        [3, "new K(new Proxy({}, {}))"],
        [2, "new K([1, 2])"],
        [2, "new K(function () {})"],
        [2, "new K(Object.create(null))"],
        [2, 'new K(Object.fromEntries(Array.from({ length: 30 }, (unused, index) => ["k" + index, index])))'],
        [2, "new K(new Map())"],
        [1, "new K(Promise.resolve(1))"],
        [1, 'new K(new Error("e"))'],
        [1, "new K(new Uint8Array(2))"],
        [1, "new K(K)"],
        [1, "new K(K.prototype)"],
        [1, "new K(undefined)"],
        [1, "new K(5)"],
        [2, "new Below({})"],
        [1, "Reflect.construct(K, [{}], Object)"],
      ])
    : random.weighted<string>([
        [4, `new Below(${argument})`],
        [3, `Reflect.construct(K, [${argument}], Other)`],
        [1, `Reflect.construct(K, [${argument}], Object)`],
        [4, `(Object.setPrototypeOf(K, Swapped), new K(${argument}))`],
        [2, `Object.freeze(new K(${argument}))`],
        [1, `new K(${argument || "3"})`],
        [1, `Object.assign(new K(${argument}), { x: 1 })`],
      ]);
  const extras = [
    odd.includes("Below") ? 'class Below extends K {\n#below = "below";\nalso() {\nreturn this.#below;\n}\n}' : "",
    odd.includes("Other") ? "class Other {}" : "",
    odd.includes("Swapped") ? `class Swapped {\nconstructor() {\nthis.swapped = true;\n}\n}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const attempt = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("refused", error.constructor.name);\n}`;
  const makes = random.chance(0.6)
    ? `for (let turn = 0; turn < ${turns}; turn++) {\n${attempt(`all.push(turn === ${at} ? ${odd} : new K(${ordinary}));`)}\n}`
    : Array.from({ length: turns }, (_, turn) =>
        attempt(`all.push(${turn === at ? odd : `new K(${ordinary.replace("turn", String(turn))})`});`),
      ).join("\n");

  const asks: string[] = [
    "console.log(each.read());",
    "console.log(each.read());",
    "console.log(K.prototype.read.call(each));",
    "console.log(K.has(each));",
    'each.put("put");\nconsole.log(each.read());',
    'K.prototype.put.call(each, "put");\nconsole.log(K.prototype.read.call(each));',
    "console.log(Object.keys(each).join(), Reflect.ownKeys(each).length);",
    "console.log(Object.prototype.toString.call(each), each instanceof K);",
    'console.log(typeof each.also === "function" ? each.also() : "no heir");',
    "console.log(JSON.stringify(each));",
    "console.log(Object.isFrozen(each), Object.isExtensible(each));",
  ];
  const chosen = random.sample(asks, random.pick([1, 2, 2, 3]));
  const told = `for (const each of all) {\n${attempt(chosen.join("\n"))}\n}`;
  const stranger = random.chance(0.4)
    ? attempt(
        random.pick([
          "console.log(K.has({}));",
          "console.log(K.prototype.read.call({}));",
          'K.prototype.put.call({}, 1);\nconsole.log("stored");',
          "console.log(K.has(K), K.has(K.prototype));",
          "console.log(K.has(5));",
        ]),
      )
    : "";

  const scene = ["const all = [];", makes, "console.log(all.length);", told, stranger].filter(Boolean).join("\n");
  const head = [declaredAbove, K, extras].filter(Boolean).join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "top", "once", "all inside", "twice"] as const);
  if (where === "top") return { file, text: `${head}\n${scene}\n` };
  if (where === "all inside") return { file, text: `function run() {\n${head}\n${scene}\n}\nrun();\nrun();\n` };
  return { file, text: `${head}\nfunction run() {\n${scene}\n}\n${where === "once" ? "run();" : "run();\nrun();"}\n` };
}
