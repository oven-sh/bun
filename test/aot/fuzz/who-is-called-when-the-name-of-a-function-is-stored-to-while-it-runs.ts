// Small programs about one function, method or class and one store to the name by which it is called, made while a call of it runs. A call takes what the name holds at the moment its callee is
// evaluated: ahead of the arguments, behind every store that has run by then. There is one scene, no helper, and every line is printed at once, by `console.log` itself.
//
//   the callee   a declared function, one held by `let` or `var`, a function expression with a name of its own, a method of a literal, of a class, a static one, an arrow in a field, the method
//                that `super` finds, a class that is constructed, an export of a module, the default export, a member of `exports`; plain, async or a generator
//   the store    `=`, patterns, `&&=`, the head of a loop, a closure, a callback of a built-in, `eval`, a `var`, a `let` or a function in a block of the same name; for members also a key in
//                brackets, `Object.defineProperty` with a value or a getter, `Object.assign`, `Reflect.set`, another prototype, `delete` over a member above; for exports the file's own function
//   the moment   in every call, at one depth, in the argument of the next call, in a default of a parameter, in a `finally` behind the `return`, in a closure that the caller hands in, in the
//                `valueOf` of the argument, while the function is suspended, between two calls, in the argument, the key or the receiver of the first call
//   the call     `f(..)`, `?.`, `(0, f)(..)`, `call`, `apply`, `Reflect.apply`, `bind`, a spread, a key in brackets, `new`, `Reflect.construct`; in the tail, in a sum, with a sum handed on
//   from where   straight, in a loop, as the callback of `map` and `Array.from`, in an arrow handed to `map`
//   where        the top of the file, a function called once or three times, with the declarations inside or outside; strict or not
import type { Random } from "./random";

type Name = { receiver?: string; name: string };
type Made = { file: string; text: string; files?: Record<string, string> };
type Flavor = "plain" | "async" | "generator";

export function generate(random: Random): Made {
  const kind = random.weighted([
    [5, "declared"],
    [4, "held"],
    [2, "named expression"],
    [4, "literal"],
    [5, "class"],
    [3, "static"],
    [2, "field"],
    [3, "super"],
    [3, "constructed"],
    [4, "module"],
    [3, "exports"],
  ] as const);
  const isFiles = kind === "module" || kind === "exports";
  const isModule = random.chance(0.5);
  const flavor: Flavor =
    kind === "constructed" || kind === "super" || kind === "field"
      ? "plain"
      : random.weighted([
          [6, "plain"],
          [1, "async"],
          [1, "generator"],
        ] as const);
  const accumulates = flavor === "plain" && kind !== "constructed" && random.chance(0.25);
  const depth = accumulates ? random.between(3, 7) : random.between(1, 3);

  // The names by which the callee is reached from inside its own body and from the scene.
  const R = random.pick(["this", "o"]);
  const inside: Name = {
    declared: { name: "f" },
    held: { name: "f" },
    "named expression": { name: "f" },
    literal: { receiver: R, name: "m" },
    class: { receiver: R, name: "m" },
    static: { receiver: random.pick(["this", "K"]), name: "m" },
    field: { receiver: R, name: "m" },
    super: { receiver: "super", name: "m" },
    constructed: { name: "K" },
    module: { name: "f" },
    exports: { receiver: random.pick(["exports", "module.exports", "this"]), name: "f" },
  }[kind];
  const road = random.pick(["named", "named", "namespace", "required", "taken apart", "default"] as const);
  const outside: Name = {
    declared: { name: "f" },
    held: { name: "f" },
    "named expression": { name: "outer" },
    literal: { receiver: "o", name: "m" },
    class: { receiver: "o", name: "m" },
    static: { receiver: "K", name: "m" },
    field: { receiver: "o", name: "m" },
    super: { receiver: "o", name: "m" },
    constructed: { name: "K" },
    module: road === "namespace" || road === "required" ? { receiver: "lib", name: "f" } : { name: "f" },
    exports: road === "taken apart" || road === "named" ? { name: "f" } : { receiver: "lib", name: "f" },
  }[kind];

  const second = kind === "constructed" ? "Other" : "g";
  const plainStores = (n: string) => [
    `${n} = ${second}`,
    `${n} = ${second}`,
    `${n} = ${second}`,
    `[${n}] = [${second}]`,
    `({ ${n} } = { ${n}: ${second} })`,
    `${n} &&= ${second}`,
    `${n} ??= ${second}`,
    "swap()",
    "swap()",
    `(() => {\n${n} = ${second};\n})()`,
    `[${second}].forEach(each => {\n${n} = each;\n})`,
    `eval("${n} = ${second}")`,
  ];
  const memberStores = (r: string, n: string) => [
    `${r}.${n} = ${second}`,
    `${r}.${n} = ${second}`,
    `${r}["${n}"] = ${second}`,
    `${r}[["${n}"][0]] = ${second}`,
    `Object.defineProperty(${r}, "${n}", { value: ${second}, writable: true, configurable: true })`,
    `Object.defineProperty(${r}, "${n}", { get: () => ${second}, configurable: true })`,
    `Object.assign(${r}, { ${n}: ${second} })`,
    `Reflect.set(${r}, "${n}", ${second})`,
    `({ ${n}: ${r}.${n} } = { ${n}: ${second} })`,
    `[${r}.${n}] = [${second}]`,
    `${r}.${n} &&= ${second}`,
  ];
  const stores = (isInside: boolean): string[] => {
    const r = isInside ? R : "o";
    const above = (p: string) => [`(Object.setPrototypeOf(${p}, { m: g }), delete ${p}.m)`];
    switch (kind) {
      case "declared":
      case "held":
      case "constructed":
        return plainStores(inside.name);
      case "named expression":
        return [`f = g`, `f = g`, `[f] = [g]`, `f &&= g`, `(() => {\nf = g;\n})()`, `eval("f = g")`];
      case "literal":
        return [...memberStores(r, "m"), ...above(r)];
      case "field":
        return [...memberStores(r, "m"), `(K.prototype.m = g, delete ${r}.m)`];
      case "class": {
        const p = random.pick([
          "K.prototype",
          "K.prototype",
          `Object.getPrototypeOf(${r})`,
          `${r}.constructor.prototype`,
          `${r}.__proto__`,
        ]);
        return [
          ...memberStores(p, "m"),
          ...memberStores(r, "m").slice(0, 6),
          ...above(p),
          `Object.setPrototypeOf(${r}, { m: g })`,
          `${r}.__proto__ = { m: g }`,
        ];
      }
      case "static":
        return [...memberStores(isInside ? inside.receiver! : "K", "m"), ...above("K")];
      case "super":
        return [
          ...memberStores("Above.prototype", "m"),
          "Object.setPrototypeOf(K.prototype, { m: g })",
          "Object.setPrototypeOf(K.prototype, { m: g })",
          "delete Above.prototype.m",
          ...above("Above.prototype"),
          `${r}.m = g`,
        ];
      case "module":
        return isInside ? plainStores("f").filter(text => !text.startsWith("eval")) : ["swap()"];
      case "exports":
        return isInside
          ? [
              ...memberStores("exports", "f").slice(0, 8),
              ...memberStores("module.exports", "f").slice(0, 3),
              "module.exports = { f: g }",
            ]
          : outside.receiver
            ? // A store that is written to a member of a namespace is refused when the program is built.
              memberStores("lib", "f").filter(text => road !== "namespace" || /^(Object|Reflect)\./.test(text))
            : ["swap()"];
    }
  };

  const insideMoments = [
    "every call",
    "every call",
    "one depth",
    "one depth",
    "the next argument",
    "the next argument",
    "a default",
    "a finally",
    "handed in",
    "converted",
  ] as const;
  const outsideMoments = [
    "between",
    "the first argument",
    "the first argument",
    "the key",
    "the receiver",
    "suspended",
  ] as const;
  let moment: (typeof insideMoments)[number] | (typeof outsideMoments)[number] = random.chance(0.7)
    ? random.pick(insideMoments)
    : random.pick(outsideMoments);
  if (kind === "named expression" && !(insideMoments as readonly string[]).includes(moment)) moment = "every call";
  if ((moment === "the key" || moment === "the receiver") && !outside.receiver) moment = "the first argument";
  if (moment === "suspended" && flavor === "plain") moment = "between";
  if (moment === "a finally" && flavor === "generator") moment = "one depth";
  const isInside =
    (insideMoments as readonly string[]).includes(moment) && moment !== "handed in" && moment !== "converted";
  // A closure or an object that the scene makes stores by the scene's names, unless the name belongs to another file.
  const byTheScene = moment === "handed in" || moment === "converted";
  let store = random.pick(
    stores(isInside || (byTheScene && !isFiles && kind !== "named expression" ? false : isInside)),
  );
  if (byTheScene) {
    if (kind === "named expression") moment = "every call";
    store = random.pick(stores(kind === "named expression")).replaceAll("this", "o");
  }
  if (moment === "a default") store = store.replaceAll("this", kind === "static" ? "K" : "o");
  const statementsAlone =
    (kind === "declared" || kind === "held" || kind === "module") && (moment === "every call" || moment === "one depth")
      ? [
          "var f = g;",
          "for (f of [g]);",
          "for (var f of [g]);",
          // In sloppy-mode code plain Bun keeps such a function inside its block.
          ...(isModule || kind === "module" ? [`{\nfunction f(m) {\nreturn "c" + m;\n}\n}`] : []),
          "let f = g;",
          "for (const each of [g]) f = each;",
        ]
      : [];
  const written = statementsAlone.length && random.chance(0.3) ? random.pick(statementsAlone) : `${store};`;

  const call = (to: Name, given: string): string => {
    const { receiver: r, name: n } = to;
    if (kind === "constructed")
      return random.pick([`new ${n}(${given})`, `new ${n}(${given})`, `Reflect.construct(${n}, [${given}])`]);
    if (r === "super")
      return random.pick([
        `super.m(${given})`,
        `super.m(${given})`,
        `super["m"](${given})`,
        `super.m.call(this, ${given})`,
      ]);
    if (!r)
      return random.pick([
        `${n}(${given})`,
        `${n}(${given})`,
        `${n}(${given})`,
        `${n}(${given})`,
        `${n}?.(${given})`,
        `(0, ${n})(${given})`,
        `${n}.call(undefined, ${given})`,
        `${n}.apply(undefined, [${given}])`,
        `Reflect.apply(${n}, undefined, [${given}])`,
        `${n}.bind(undefined)(${given})`,
        `${n}(...[${given}])`,
      ]);
    return random.pick([
      `${r}.${n}(${given})`,
      `${r}.${n}(${given})`,
      `${r}.${n}(${given})`,
      `${r}.${n}(${given})`,
      `${r}["${n}"](${given})`,
      `${r}?.${n}(${given})`,
      `${r}.${n}?.(${given})`,
      `${r}.${n}.call(${r}, ${given})`,
      `${r}.${n}.apply(${r}, [${given}])`,
      `Reflect.apply(${r}.${n}, ${r}, [${given}])`,
      `${r}.${n}(...[${given}])`,
      `${r}[["${n}"][0]](${given})`,
    ]);
  };

  // The bodies.
  const next = (letter: string) => {
    const less = moment === "the next argument" && letter === "a" ? `(${store}, n - 1)` : "n - 1";
    return accumulates ? `${less}, sum + "${letter}"` : less;
  };
  const handsOn = moment === "handed in" ? ", then" : "";
  const parameters = `n${accumulates ? ', sum = ""' : ""}${moment === "handed in" ? ", then" : ""}${moment === "a default" ? `, unused = ${store}` : ""}`;
  const stops = (letter: string) =>
    flavor === "generator"
      ? `yield "${letter}";\nif (!(n > 0)) return;`
      : `if (!(n > 0)) return ${accumulates ? `sum + "${letter}"` : `"${letter}"`};`;
  const goesOn = (letter: string, to: Name, more = "") => {
    const called = call(to, next(letter) + more);
    if (flavor === "generator") return `yield* ${called};`;
    if (flavor === "async") return `return "${letter}" + (await ${called});`;
    if (accumulates) return `return ${called};`;
    return random.pick([
      `return ${called};`,
      `return "${letter}" + ${called};`,
      `return "${letter}" + ${called};`,
      `const answer = ${called};\nreturn "${letter}" + answer;`,
    ]);
  };
  const at = random.between(1, depth);
  const firstBody =
    kind === "constructed"
      ? [
          `this.told = "a";`,
          "if (!(n > 0)) return;",
          moment === "every call" ? written : moment === "one depth" ? `if (n === ${at}) ${written}` : "",
          moment === "handed in" ? "then?.();" : "",
          moment === "a finally"
            ? `try {\nthis.next = ${call(inside, next("a"))};\n} finally {\n${written}\n}`
            : `this.next = ${call(inside, next("a") + handsOn)};`,
        ]
      : [
          stops("a"),
          moment === "every call"
            ? written
            : moment === "one depth"
              ? written.startsWith("{") || written.startsWith("let")
                ? written
                : `if (n === ${at}) ${written}`
              : "",
          moment === "handed in" ? "then?.();" : "",
          moment === "a finally"
            ? `try {\n${goesOn("a", inside)}\n} finally {\n${written}\n}`
            : goesOn("a", inside, handsOn),
        ];
  const first = firstBody.filter(Boolean).join("\n");
  const back: Name =
    inside.receiver === "super"
      ? { receiver: "this", name: "m" }
      : inside.receiver === "o" || inside.receiver === "K" || !inside.receiver || isFiles
        ? inside
        : { receiver: "this", name: inside.name };
  const secondBody =
    kind === "constructed"
      ? `this.told = "b" + n;`
      : random.chance(0.5) || flavor === "generator"
        ? flavor === "generator"
          ? `return ["b" + n];`
          : `return ${accumulates ? "sum + " : ""}"b" + n;`
        : `if (!(n > 0)) return ${accumulates ? 'sum + "b"' : '"b"'};\nreturn ${accumulates ? "" : '"b" + '}${flavor === "async" ? "(await " : ""}${call(back, accumulates ? 'n - 1, sum + "b"' : "n - 1")}${flavor === "async" ? ")" : ""};`;
  const secondIsAsync = flavor === "async" && secondBody.includes("await");
  const word = flavor === "async" ? "async function" : flavor === "generator" ? "function*" : "function";
  const mark = flavor === "async" ? "async " : flavor === "generator" ? "*" : "";
  const g =
    kind === "constructed"
      ? `class Other {\nconstructor(n) {\n${secondBody}\n}\n}`
      : `${secondIsAsync ? "async " : ""}function g(n${accumulates ? ', sum = ""' : ""}) {\n${secondBody}\n}`;
  const usesSwap = written.includes("swap()") || store.includes("swap()");
  const swap = usesSwap
    ? random.pick([
        `function swap() {\n${inside.name} = ${second};\n}`,
        `const swap = () => {\n${inside.name} = ${second};\n};`,
      ])
    : "";

  const isArrow = kind === "held" && flavor === "plain" && random.chance(0.3);
  const declared: string = {
    declared: () => random.shuffled([`${word} f(${parameters}) {\n${first}\n}`, g]).join("\n"),
    held: () =>
      `${g}\n${random.pick(["let", "let", "var"])} f = ${isArrow ? `(${parameters}) =>` : `${word} (${parameters})`} {\n${first}\n};`,
    "named expression": () => `${g}\nconst outer = ${word} f(${parameters}) {\n${first}\n};`,
    literal: () =>
      `${g}\nconst o = {\n${random.chance(0.7) || flavor !== "plain" ? `${mark}m(${parameters})` : `m: function (${parameters})`} {\n${first}\n},\n};`,
    class: () => `${g}\nclass K {\n${mark}m(${parameters}) {\n${first}\n}\n}\nconst o = new K();`,
    static: () => `${g}\nclass K {\nstatic ${mark}m(${parameters}) {\n${first}\n}\n}`,
    field: () => `${g}\nclass K {\nm = (${parameters}) => {\n${first}\n};\n}\nconst o = new K();`,
    super: () =>
      random.chance(0.7)
        ? `${g}\nclass Above {\nm(n) {\nreturn "above" + n;\n}\n}\nclass K extends Above {\nm(${parameters}) {\n${first}\n}\n}\nconst o = new K();`
        : `${g}\nclass Above {\nm(n) {\nreturn "above" + n;\n}\n}\nconst K = { prototype: { __proto__: Above.prototype, m(${parameters}) {\n${first}\n} } };\nconst o = Object.create(K.prototype);`,
    constructed: () =>
      `${g}\n${random.pick(["let K = class", "let K = class", "class K", "class K", "var K = class K", "let K = function"])}`.replace(
        /(let K = function|.+)$/,
        head =>
          head === "let K = function"
            ? `let K = function (${parameters}) {\n${first}\n};`
            : `${head} {\nconstructor(${parameters}) {\n${first}\n}\n}${head.startsWith("class") ? "" : ";"}`,
      ),
    module: () => "",
    exports: () => "",
  }[kind]();

  // The scene.
  const handed = moment === "handed in" ? `${accumulates ? ', ""' : ""}, () => {\n${store};\n}` : "";
  const argument = (n: number) => (moment === "converted" ? `{\nvalueOf() {\n${store};\nreturn ${n};\n},\n}` : `${n}`);
  const shows = (called: string) =>
    kind === "constructed"
      ? `console.log(JSON.stringify(${called}));`
      : flavor === "async"
        ? `console.log(await ${called});`
        : flavor === "generator"
          ? `console.log([...${called}].join());`
          : `console.log(${called});`;
  const canBeACallback =
    flavor === "plain" &&
    kind !== "constructed" &&
    !accumulates &&
    !handed &&
    moment !== "a default" &&
    moment !== "converted";
  const o = outside;
  const firstCall = (): string => {
    if (moment === "the first argument") return shows(call(o, `(${store}, ${depth})`));
    if (moment === "the key") return shows(`${o.receiver}[(${store}, "${o.name}")](${depth})`);
    if (moment === "the receiver") return shows(`(${store}, ${o.receiver}).${o.name}(${depth})`);
    if (moment === "suspended")
      return flavor === "async"
        ? `const waits = ${call(o, `${depth}`)};\n${store};\nconsole.log(await waits);`
        : `const steps = ${call(o, `${depth}`)};\nconsole.log(steps.next().value);\n${store};\nconsole.log([...steps].join());`;
    if (moment === "between") return `${shows(call(o, `${depth}`))}\n${store};`;
    if (canBeACallback && random.chance(0.3)) {
      const held = o.receiver ? `${o.receiver}.${o.name}` : o.name;
      return random.pick([
        `console.log([${depth}, 1, 0].map(${held}${o.receiver ? `, ${o.receiver}` : ""}).join());`,
        `console.log(Array.from([${depth}, 1], ${held}${o.receiver ? `, ${o.receiver}` : ""}).join());`,
        `console.log([${depth}, 1, 0].map(each => ${call(o, "each")}).join());`,
        `for (let turn = 0; turn < 3; turn++) console.log(${call(o, "turn")});`,
        `for (const each of [${depth}, 1]) console.log(${call(o, "each")});`,
      ]);
    }
    return shows(call(o, argument(depth) + handed));
  };
  const behind = random.pick([
    "",
    shows(call(o, "1")),
    shows(call(o, "1")),
    shows(call(o, "0")),
    kind === "constructed"
      ? "console.log(K.name);"
      : `console.log(typeof ${o.receiver ? `${o.receiver}.${o.name}` : o.name});`,
    kind === "constructed"
      ? "console.log(K === Other);"
      : isFiles
        ? ""
        : `console.log(${o.receiver ? `${o.receiver}.${o.name}` : o.name} === g);`,
  ]);
  const scene = [firstCall(), behind].filter(Boolean).join("\n");
  const waits = flavor === "async";
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;

  if (isFiles) {
    const sceneSwaps = scene.includes("swap()");
    if (kind === "module") {
      const form = random.pick(["declared", "declared", "held", "listed"] as const);
      const isDefault = road === "default";
      const lib = [
        form === "declared"
          ? `export ${isDefault ? "default " : ""}${word} f(${parameters}) {\n${first}\n}`
          : form === "held" && !isDefault
            ? `export let f = ${word} (${parameters}) {\n${first}\n};`
            : `${random.pick(["let f = ", ""])}${word} f(${parameters}) {\n${first}\n}\nexport { f${isDefault ? " as default" : ""} };`.replace(
                /^let f = ([^]*?)\nexport/,
                (_, text) => `let f = ${text};\nexport`,
              ),
        g,
        usesSwap || sceneSwaps ? `export function swap() {\nf = g;\n}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const names = sceneSwaps ? ", swap" : "";
      const head = {
        named: `import { f${names} } from "./lib.mjs";`,
        default: `import f${sceneSwaps ? ", { swap }" : ""} from "./lib.mjs";`,
        namespace: `import * as lib from "./lib.mjs";${sceneSwaps ? "\nconst { swap } = lib;" : ""}`,
        required: `const lib = require("./lib.mjs");${sceneSwaps ? "\nconst { swap } = lib;" : ""}`,
        "taken apart": `const { f${names} } = require("./lib.mjs");`,
      }[road];
      const isRequired = road === "required" || road === "taken apart";
      const isMainAModule = !isRequired || random.chance(0.3);
      const body = guarded(scene);
      return {
        file: isMainAModule ? "main.mjs" : "main.cjs",
        text: `${head}\n${waits && !isMainAModule ? `(async () => {\n${body}\n})();` : body}\n`,
        files: { "lib.mjs": lib + "\n" },
      };
    }
    const lib = [
      g,
      `exports.f = ${word} (${parameters}) {\n${first}\n};`,
      sceneSwaps || usesSwap
        ? `${usesSwap && !sceneSwaps ? "function swap() {\nexports.f = g;\n}" : "exports.swap = function () {\nexports.f = g;\n};"}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const isMainAModule = road === "named" || road === "default" || road === "namespace";
    const head = {
      named: `import { f${sceneSwaps ? ", swap" : ""} } from "./lib.cjs";`,
      default: `import lib from "./lib.cjs";${sceneSwaps ? "\nconst { swap } = lib;" : ""}`,
      namespace: `import * as lib from "./lib.cjs";${sceneSwaps ? "\nconst { swap } = lib;" : ""}`,
      required: `const lib = require("./lib.cjs");${sceneSwaps ? "\nconst { swap } = lib;" : ""}`,
      "taken apart": `const { f${sceneSwaps ? ", swap" : ""} } = require("./lib.cjs");`,
    }[road];
    const body = guarded(scene);
    return {
      file: isMainAModule ? "main.mjs" : "main.cjs",
      text: `${head}\n${waits && !isMainAModule ? `(async () => {\n${body}\n})();` : body}\n`,
      files: { "lib.cjs": lib + "\n" },
    };
  }

  const file = isModule ? "main.mjs" : "main.cjs";
  const all = [declared, swap].filter(Boolean).join("\n");
  let place = random.pick(["top", "top", "top", "once", "once", "thrice", "scene inside", "scene inside"] as const);
  if (waits && !isModule && place === "top") place = "once";
  const runs = (times: number) =>
    waits
      ? isModule
        ? Array(times).fill("await run();").join("\n")
        : `run()${".then(run)".repeat(times - 1)};`
      : Array(times).fill("run();").join("\n");
  const run = waits ? "async function run()" : "function run()";
  if (place === "top") return { file, text: `${all}\n${guarded(scene)}\n` };
  if (place === "scene inside")
    return { file, text: `${all}\n${run} {\n${guarded(scene)}\n}\n${runs(random.pick([1, 1, 2]))}\n` };
  return { file, text: `${run} {\n${all}\n${guarded(scene)}\n}\n${runs(place === "once" ? 1 : 3)}\n` };
}
