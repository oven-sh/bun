// Small programs about one variable, one or two closures that read it and a few stores to it, written into the places of a statement whose parts do not run in the order in which they are written.
// A closure sees every store that runs behind its making, wherever that store is written. There is one statement in a program, no helper, and the line is printed at once, by `console.log` itself.
//
//   places      the targets, keys, defaults and the right side of patterns, assigned and declared, inside each other; the three parts of the head of a `for` and its body; heads of `for of` and `for in`;
//               tests and bodies of `while`, `do` and `switch`; the class above, computed names, fields, static fields, static blocks and the constructor of a class; `super(..)` and the fields
//               behind it; defaults of parameters and the body; `try`, `catch`, `finally`; callee, key and arguments of a call; members, getters and spreads of a literal; a generator and who
//               drives it; an async function and who waits for it; a function declared below its call; `using`; `continue` to a label; what a built-in calls: a mapper, a comparator, a replacer,
//               `toString`, `valueOf`, `toJSON`, a setter, a getter, a trap, an iterator and its `return`, a job
//   its own     forms in which the statement itself is the store: `v = (g = () => v, 2)`, `v += ..`, `[g, x = v = 2] = [() => v]`, `for (v of ..)`, `(() => v)(v = 2)`; parameters that a `var` of the
//               body hides; an `arguments` object that shares its elements with the parameters
//   the closure an arrow, a function, a bound function, an arrow in an arrow, a method, a getter, a method or a field of a class, a generator, a default of a parameter, a template, one that stores
//   the store   `=`, `+=`, `++`, a list pattern, an object pattern
//   the variable `let`, `var`, a parameter, one with a default, one in a pattern, of a `catch`, of the head of a loop
//   where       the top of the file, a function called once, a function called three times, an async function, a generator, a method; strict or not
import type { Random } from "./random";

type Slots = { e: (natural: string) => string; s: () => string };
type Needs = "" | "waits" | "is not strict";

const places: [Needs, (slots: Slots) => string][] = [
  ["", ({ e }) => `let x;\nconst t = {};\n[t[${e('"a"')}], x = ${e("0")}] = ${e("[1]")};`],
  ["", ({ e }) => `let x;\nconst t = {};\n[[t[${e('"a"')}] = ${e("0")}], x = ${e("0")}] = ${e("[[]]")};`],
  [
    "",
    ({ e }) =>
      `let x;\nconst t = {};\n({ [${e('"a"')}]: t[${e('"b"')}] = ${e("0")}, x = ${e("0")}, ...t[${e('"rest"')}] } = ${e("{}")});`,
  ],
  ["", ({ e }) => `let [[p = ${e("0")}], q = ${e("0")}, { r = ${e("0")} } = ${e("{}")}] = ${e("[[]]")};`],
  [
    "",
    ({ e }) => `const { [${e('"a"')}]: { [${e('"b"')}]: p = ${e("0")} } = ${e("{}")}, q = ${e("0")} } = ${e("{}")};`,
  ],
  ["", ({ e }) => `var [p = ${e("0")}, ...[q = ${e("0")}]] = ${e("[]")};`],
  ["", ({ e, s }) => `for (let i = ${e("0")}; ${e("i < 2")}; ${e("i++")}) {\n${s()}\n}`],
  [
    "",
    ({ e, s }) =>
      `for (var i = ${e("0")}, j = ${e("0")}; ${e("i < 3")}; ${e("i++")}, ${e("j++")}) {\n${s()}\nif (i === 1) continue;\n${s()}\n}`,
  ],
  ["", ({ e, s }) => `for (const each of ${e("[1, 2]")}) {\n${s()}\n}`],
  ["", ({ e, s }) => `for (const [a = ${e("0")}, b = ${e("0")}] of ${e("[[], []]")}) {\n${s()}\n}`],
  ["", ({ e, s }) => `const t = {};\nfor (t[${e('"k"')}] of ${e("[1, 2]")}) {\n${s()}\n}`],
  ["", ({ e, s }) => `const t = {};\nfor ([t[${e('"k"')}] = ${e("0")}] of ${e("[[], []]")}) {\n${s()}\n}`],
  ["", ({ e, s }) => `const t = {};\nfor (t[${e('"k"')}] in ${e("{ a: 1, b: 2 }")}) {\n${s()}\n}`],
  ["is not strict", ({ e, s }) => `for (var x = ${e("0")} in ${e("{ a: 1 }")}) {\n${s()}\n}`],
  ["", ({ e, s }) => `let n = 0;\nwhile (${e("n++ < 2")}) {\n${s()}\n${s()}\n}`],
  ["", ({ e, s }) => `let n = 0;\ndo {\n${s()}\n${s()}\n} while (${e("n++ < 1")});`],
  [
    "",
    ({ e, s }) =>
      `switch (${e("1")}) {\ncase ${e("0")}:\n${s()}\ncase ${e("1")}:\n${s()}\nbreak;\ncase ${e("2")}:\n${s()}\ndefault:\n${s()}\n}`,
  ],
  ["", ({ e, s }) => `switch (${e("5")}) {\ncase ${e("0")}:\n${s()}\ndefault:\n${s()}\ncase ${e("1")}:\n${s()}\n}`],
  [
    "",
    ({ e, s }) =>
      `class K extends ${e("Object")} {\nstatic [${e('"a"')}] = ${e("0")};\n[${e('"b"')}] = ${e("0")};\nstatic {\n${s()}\n}\n[${e('"m"')}]() {}\nc = ${e("0")};\nconstructor() {\n${s()}\nsuper();\n${s()}\n}\n}\n${s()}\nnew K();`,
  ],
  [
    "",
    ({ e, s }) =>
      `const K = class {\n[${e('"b"')}] = ${e("0")};\nstatic [${e('"a"')}] = ${e("0")};\nget [${e('"c"')}]() {\nreturn ${e("0")};\n}\n};\n${s()}\nnew K().c;`,
  ],
  [
    "",
    ({ e, s }) =>
      `class Above {\nconstructor(given) {\n${s()}\n}\n}\nclass Below extends Above {\nf = ${e("0")};\nconstructor() {\nsuper(${e("0")});\n${s()}\n}\n}\n${s()}\nnew Below();`,
  ],
  [
    "",
    ({ e, s }) =>
      `function inner(a = ${e("0")}, { b = ${e("0")} } = ${e("{}")}, ...[c = ${e("0")}]) {\n${s()}\n}\n${s()}\ninner();`,
  ],
  ["", ({ e, s }) => `const inner = (a = ${e("0")}, b = ${e("0")}) => ${e("0")};\n${s()}\ninner(${e("undefined")});`],
  ["", ({ e, s }) => `try {\n${s()}\nthrow ${e("0")};\n} catch ({ a = ${e("0")} }) {\n${s()}\n} finally {\n${s()}\n}`],
  ["", ({ e, s }) => `const answer = (() => {\ntry {\nreturn ${e("0")};\n} finally {\n${s()}\n}\n})();`],
  ["", ({ s }) => `out: try {\n${s()}\nbreak out;\n} finally {\n${s()}\n}`],
  ["", ({ e, s }) => `const t = {\nk() {\n${s()}\n},\n};\nt[${e('"k"')}](${e("0")}, ...${e("[]")});`],
  ["", ({ e }) => `const t = { k: null };\nt?.[${e('"k"')}]?.[${e('"never"')}](${e("0")});`],
  ["", ({ e }) => `new (${e("Object")})(${e("0")});`],
  [
    "",
    ({ e, s }) =>
      `const o = {\n[${e('"a"')}]: ${e("0")},\nget [${e('"b"')}]() {\nreturn ${e("0")};\n},\n...${e("{}")},\n[${e('"c"')}]: ${e("0")},\n};\n${s()}\no.b;`,
  ],
  [
    "",
    ({ e, s }) =>
      `function* steps() {\n${s()}\nyield ${e("0")};\n${s()}\n}\nconst it = steps();\n${s()}\nit.next();\n${s()}\nit.next();\n${s()}`,
  ],
  [
    "",
    ({ e, s }) =>
      `function* steps() {\n${s()}\nconst sent = yield;\n${s()}\n}\nconst it = steps();\nit.next();\nit.next(${e("0")});`,
  ],
  [
    "waits",
    ({ e, s }) =>
      `async function later() {\n${s()}\nawait ${e("0")};\n${s()}\n}\nconst waits = later();\n${s()}\nawait waits;\n${s()}`,
  ],
  ["", ({ s }) => `${s()}\nhoisted();\n${s()}\nfunction hoisted() {\n${s()}\n}`],
  ["", ({ e, s }) => `hoisted(${e("0")}, ${e("0")});\nfunction hoisted(a = ${e("0")}) {\n${s()}\n}`],
  ["", ({ s }) => `{\nusing held = {\n[Symbol.dispose]() {\n${s()}\n},\n};\n${s()}\n}\n${s()}`],
  ["", ({ e, s }) => `outer: for (let i = 0; i < 2; ${e("i++")}) {\nfor (;;) {\n${s()}\ncontinue outer;\n}\n}`],
  ["", ({ s }) => `${s()}\n[1, 2].forEach(each => {\n${s()}\n});\n${s()}`],
  ["", ({ e }) => `[2, 1, 3].sort((a, b) => ${e("a - b")});`],
  ["", ({ e }) => `"ab".replace(/./g, () => ${e('""')});`],
  ["", ({ e }) => `Array.from({ length: 2 }, () => ${e("0")});`],
  [
    "waits",
    ({ s }) =>
      `const waits = new Promise(resolve => {\n${s()}\nresolve(0);\n}).then(() => {\n${s()}\n});\n${s()}\nawait waits;`,
  ],
  ["waits", ({ s }) => `queueMicrotask(() => {\n${s()}\n});\n${s()}\nawait null;\n${s()}`],
  [
    "",
    ({ e, s }) =>
      `const told = {\ntoString() {\n${s()}\nreturn "";\n},\n};\nconst text = \`\${${e('""')}}\${told}\${${e('""')}}\`;`,
  ],
  [
    "",
    ({ e, s }) => `const told = {\nvalueOf() {\n${s()}\nreturn 1;\n},\n};\nconst sum = ${e("1")} + told + ${e("1")};`,
  ],
  ["", ({ e, s }) => `const t = {\nset k(given) {\n${s()}\n},\n};\nt[${e('"k"')}] = ${e("0")};`],
  ["", ({ e }) => `const o = {\n...{\nget a() {\nreturn ${e("0")};\n},\n},\nb: ${e("0")},\n};`],
  ["", ({ e }) => `${e("0")} || (${e("1")} && ${e("0")}) || ${e("0")};`],
  ["", ({ e }) => `${e("0")} ? ${e("0")} : ${e("0")};`],
  ["", ({ e }) => `${e("null")} ?? ${e("0")};`],
  ["", ({ e }) => `const t = { k: 1 };\nt[${e('"k"')}] += ${e("1")};`],
  ["", ({ e }) => `const t = { k: 0 };\nt[${e('"k"')}] ||= ${e("1")};`],
  ["", ({ e, s }) => `function tag() {\n${s()}\n}\ntag\`a\${${e("0")}}b\${${e("0")}}\`;`],
  [
    "",
    ({ e, s }) =>
      `const source = {\n[Symbol.iterator]() {\n${s()}\nreturn {\nnext() {\n${s()}\nreturn { done: true };\n},\n};\n},\n};\nconst [a = ${e("0")}] = source;`,
  ],
  [
    "",
    ({ s }) =>
      `const source = {\n[Symbol.iterator]() {\nreturn {\nnext() {\nreturn { done: false, value: 1 };\n},\nreturn() {\n${s()}\nreturn {};\n},\n};\n},\n};\nfor (const each of source) {\n${s()}\nbreak;\n}`,
  ],
  ["", ({ s }) => `JSON.stringify({\ntoJSON() {\n${s()}\nreturn 1;\n},\n});\n${s()}`],
  ["", ({ s }) => `const t = new Proxy(\n{},\n{\nget() {\n${s()}\nreturn 1;\n},\n},\n);\n${s()}\nt.k;`],
  ["", ({ e }) => `${e('"k"')} in ${e("{}")};`],
  ["", ({ e }) => `const list = [${e("0")}, ...${e("[]")}, ${e("0")}];`],
  ["", ({ e, s }) => `if (${e("1")}) {\n${s()}\n} else {\n${s()}\n}`],
  [
    "",
    ({ e, s }) =>
      `function* inner() {\n${s()}\nyield* ${e("[1]")};\n${s()}\n}\n${s()}\nfor (const each of inner()) {\n${s()}\n}`,
  ],
];

export function generate(random: Random): { file: string; text: string } {
  const isStrict = random.chance(0.75);
  const closures: [string, (name: string) => string][] = [
    ["() => v", g => `${g}()`],
    ["() => v", g => `${g}()`],
    ["() => v", g => `${g}()`],
    ["function () {\nreturn v;\n}", g => `${g}()`],
    ["(function () {\nreturn v;\n}).bind(null)", g => `${g}()`],
    ["() => () => v", g => `${g}()()`],
    ["{\nread() {\nreturn v;\n},\n}", g => `${g}.read()`],
    ["{\nget value() {\nreturn v;\n},\n}", g => `${g}.value`],
    ["class {\nread() {\nreturn v;\n}\n}", g => `new ${g}().read()`],
    ["class {\nheld = v;\n}", g => `new ${g}().held`],
    ["function* () {\nyield v;\n}", g => `${g}().next().value`],
    ["(given = v) => given", g => `${g}()`],
    ["() => `${v}`", g => `${g}()`],
    ["() => [v, v].join()", g => `${g}()`],
    ["() => (v = v * 10 + 8)", g => `${g}()`],
    ["() => v++", g => `${g}()`],
  ];
  const drawnClosures = [random.pick(closures), random.pick(closures)];
  const names = ["g", "h"];
  let digit = 1;
  const store = () => {
    digit++;
    return random.weighted([
      [6, `(v = v * 10 + ${digit})`],
      [2, `(v = ${digit})`],
      [1, `(v += ${digit})`],
      [1, `v++`],
      [1, `([v] = [v * 10 + ${digit}])`],
      [1, `({ v } = { v: v * 10 + ${digit} })`],
    ]);
  };
  const make = (which: number) => `(${names[which]} ${random.chance(0.8) ? "=" : "??="} ${drawnClosures[which][0]})`;
  const call = (which: number) => `${names[which]} ? ${drawnClosures[which][1](names[which])} : "never made"`;

  let needs: Needs = "";
  let statement: string;
  let made = 1;
  let ownLine = "";
  if (random.chance(0.3)) {
    // The statement itself is the store, or hands the closure on.
    const C = drawnClosures[0][0];
    const own: [Needs, () => string][] = [
      ["", () => `let x;\n[g, x = ${store()}] = [${C}];`],
      ["", () => `let x;\n({ g, x = ${store()} } = { g: ${C} });`],
      ["", () => `let x;\n[x = ${store()}, g] = [undefined, ${C}];`],
      ["", () => `let x;\n[[g], x = ${store()}] = [[${C}]];`],
      ["", () => `const t = {};\n[g, t[${store()}]] = [${C}];`],
      ["", () => `v = (g = ${C}, v * 10 + 2);`],
      ["", () => `v += (g = ${C}, 2);`],
      ["", () => `v *= (g = ${C}, 2);`],
      ["", () => `[v] = [(g = ${C}, 2)];`],
      ["", () => `({ v } = { v: (g = ${C}, 2) });`],
      ["", () => `({ a: v } = { a: (g = ${C}, 2) });`],
      ["", () => `[g = ${C}, v] = [undefined, 2];`],
      ["", () => `[v, g = ${C}] = [2];`],
      ["", () => `[v = 5, g = ${C}] = [];`],
      ["", () => `[g = ${C}, ...v] = [undefined, 2];`],
      ["", () => `({ g = ${C}, ...v } = { k: 2 });\nv = v.k;`],
      ["", () => `for (v of [(g = ${C}, 2), 3]) {\n}`],
      ["", () => `for (v in { [(g = ${C}, "k")]: 1 }) {\n}`],
      ["", () => `for ([v] of [[(g = ${C}, 2)]]) {\n}`],
      ["", () => `for ({ v } of [{ v: (g = ${C}, 2) }]) {\n}`],
      ["", () => `v &&= (g = ${C}, 2);`],
      ["", () => `v ||= (g = ${C}, 2);`],
      ["", () => `v = v + (g = ${C}, 1) + ${store()};`],
      ["", () => ((drawnClosures[0] = closures[0]), `g = read;\n${store()};\nfunction read() {\nreturn v;\n}`)],
      [
        "",
        () => (
          (drawnClosures[0] = closures[0]),
          `${store()};\ng = read;\n${store()};\nfunction read() {\nreturn v;\n}`
        ),
      ],
      [
        "",
        () =>
          `console.log((${C.startsWith("{") || C.startsWith("class") || C.includes("bind") ? "() => v" : C})(${store()}));`,
      ],
      ["", () => `console.log((() => v)\`\${${store()}}\`);`],
      ["", () => `console.log(new (class {\nheld = v;\n})(${store()}).held);`],
      ["", () => `console.log([(g = ${C}), ${store()}].length);`],
      ["", () => `g = (${store()}, ${C});`],
      ["", () => `const o = { g: ${C}, x: ${store()} };\ng = o.g;`],
      ["", () => `const o = { x: ${store()}, g: ${C}, y: ${store()} };\ng = o.g;`],
      ["", () => `const [first, second = ${store()}] = [${C}];\ng = first;`],
      ["", () => `const { first, second = ${store()} } = { first: ${C} };\ng = first;`],
      ["", () => `(function (first, second = ${store()}) {\ng = first;\n})(${C});`],
      ["", () => `((first, second) => {\ng = first;\n})(${C}, ${store()});`],
      ["waits", () => `g = ${C};\nv = await (${store()}, 7);`],
      ["waits", () => `v = (g = ${C}, await 2);`],
      ["waits", () => `v += await (g = ${C}, 2);`],
    ];
    const whole: [Needs, string][] = [
      [
        "",
        `function inner(read = () => x, x = 1) {\nvar x;\nx = 2;\nreturn [read(), x].join();\n}\nconsole.log(inner());`,
      ],
      ["", `function inner(x, read = () => x) {\nvar x = 2;\nreturn [read(), x].join();\n}\nconsole.log(inner(1));`],
      ["", `function inner(x, read = () => x) {\nx = 2;\nreturn [read(), x].join();\n}\nconsole.log(inner(1));`],
      [
        "",
        `function inner(x = 1, read = () => x, write = () => (x = 3)) {\nvar x;\nwrite();\nreturn [read(), x].join();\n}\nconsole.log(inner());`,
      ],
      [
        "",
        `function inner(x = 1, read = () => x) {\n{\nlet x = 2;\nreturn [read(), x].join();\n}\n}\nconsole.log(inner());`,
      ],
      ["", `function inner(read = () => typeof late, late = 1) {\nlate = 2;\nreturn read();\n}\nconsole.log(inner());`],
      [
        "",
        `function inner(x, read = () => x) {\nfunction x() {}\nreturn [typeof read(), typeof x].join();\n}\nconsole.log(inner(1));`,
      ],
      [
        "is not strict",
        `function inner(a) {\nconst read = () => a;\narguments[0] = 2;\nreturn [read(), a].join();\n}\nconsole.log(inner(1));`,
      ],
      [
        "is not strict",
        `function inner(a) {\nconst read = () => arguments[0];\na = 2;\nreturn [read(), a].join();\n}\nconsole.log(inner(1));`,
      ],
      [
        "is not strict",
        `function inner(a, b) {\nconst read = () => [a, b].join();\n[arguments[0], arguments[1]] = [b, a];\nreturn read();\n}\nconsole.log(inner(1, 2));`,
      ],
      [
        "is not strict",
        `function inner(a) {\nconst read = () => a;\nArray.prototype.fill.call(arguments, 5);\nreturn read();\n}\nconsole.log(inner(1));`,
      ],
      ["", `for (let i = 0, read = () => i; i < 2; i++) console.log(read(), i);`],
      ["", `for (let i = 0, read; i < 2; read ??= () => i, i++) console.log(read ? read() : "none", i);`],
      ["", `for (let i = 0, write = () => (i += 10); i < 2; i++) console.log(write(), i);`],
    ];
    if (random.chance(0.2)) {
      let text: string;
      do [needs, text] = random.pick(whole);
      while (needs === "is not strict" && isStrict);
      statement = text;
      made = 0;
    } else {
      const [need, write] = random.pick(own);
      needs = need;
      statement = write();
      if (!/\bg\b/.test(statement.replace(C, ""))) made = 0;
    }
  } else {
    let write: (slots: Slots) => string;
    do [needs, write] = random.pick(places);
    while (needs === "is not strict" && isStrict);
    let count = 0;
    write({ e: natural => (count++, natural), s: () => (count++, "") });
    made = random.chance(0.75) ? 1 : 2;
    const effects = [
      ...Array.from({ length: made }, (_, which) => make(which)),
      ...Array.from({ length: random.pick([1, 1, 1, 2, 2, 3]) }, store),
      ...(random.chance(0.2) ? [`console.log("between", ${call(0)})`] : []),
    ];
    const inSlot: string[][] = Array.from({ length: count }, () => []);
    for (const effect of random.shuffled(effects)) inSlot[random.below(count)].push(effect);
    let at = 0;
    statement = write({
      e: natural => (inSlot[at++].length ? `(${[...inSlot[at - 1], natural].join(", ")})` : natural),
      s: () => inSlot[at++].map(effect => `${effect};`).join("\n"),
    }).replace(/\n{2,}/g, "\n");
  }
  if (made) ownLine = `console.log(${Array.from({ length: made }, (_, which) => call(which)).join(", ")}, v);`;
  else if (/\bv\b/.test(statement)) ownLine = `console.log(v);`;
  // Now and then one more store behind everything: then no closure may keep a copy at all.
  if (made && random.chance(0.15)) ownLine += `\nv = v * 10 + 9;\n${ownLine}`;

  const place =
    needs === "waits"
      ? random.pick(["top", "async"] as const)
      : random.pick(["top", "once", "once", "once", "thrice", "async", "generator", "method"] as const);
  const variable =
    place === "top"
      ? random.pick(["let", "let", "var", "catch", "loop"] as const)
      : random.pick([
          "let",
          "let",
          "let",
          "var",
          "parameter",
          "default",
          "object pattern",
          "list pattern",
          "catch",
          "loop",
        ] as const);
  const held = `let g, h;\n${statement}\n${ownLine}`.replace(
    "let g, h;",
    made === 2 ? "let g, h;" : made === 1 ? "let g;" : /\bg\b/.test(statement) ? "let g;" : "",
  );
  const body = {
    let: `let v = 1;\n${held}`,
    var: `var v = 1;\n${held}`,
    parameter: held,
    default: held,
    "object pattern": held,
    "list pattern": held,
    catch: `try {\nthrow 1;\n} catch (v) {\n${held}\n}`,
    loop: `for (let v = 1, once = true; once; once = false) {\n${held}\n}`,
  }[variable].replace(/^\n/, "");
  const [parameter, given] = {
    let: ["", ""],
    var: ["", ""],
    parameter: ["v", "1"],
    default: ["v = 1", ""],
    "object pattern": ["{ v }", "{ v: 1 }"],
    "list pattern": ["[v]", "[1]"],
    catch: ["", ""],
    loop: ["", ""],
  }[variable];
  // A file that waits at its top is a module, and those are strict.
  const file = isStrict || (place === "top" && needs === "waits") ? "main.mjs" : "main.cjs";
  const waited = file === "main.mjs" ? "await " : "";
  const text = {
    top: `${body}\n`,
    once: `function run(${parameter}) {\n${body}\n}\nrun(${given});\n`,
    thrice: `function run(${parameter}) {\n${body}\n}\nrun(${given});\nrun(${given});\nrun(${given});\n`,
    async: `async function run(${parameter}) {\n${random.chance(0.5) ? "await null;\n" : ""}${body}\n}\n${waited}run(${given});\n`,
    generator: `function* run(${parameter}) {\nyield 1;\n${body}\n}\nfor (const step of run(${given})) console.log("step", step);\n`,
    method: `const holder = {\nrun(${parameter}) {\n${body}\n},\n};\nholder.run(${given});\n`,
  }[place];
  return { file, text };
}
