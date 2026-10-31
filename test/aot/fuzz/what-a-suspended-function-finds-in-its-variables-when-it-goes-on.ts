// Small programs about one generator or async function, one variable of it and one closure that stores to that variable. The closure leaves the function by one road; whoever drives the function calls
// it while the function is suspended; the function reads the variable when it goes on. What stands to the left of the suspension in an expression was read ahead of it, what stands to the right is
// read behind it. There is one scene, no helper, and every line is printed at once, by `console.log` itself.
//
//   the function  a generator, an async function, an async generator; declared, a method, reached through `yield*`; one of them or two at once
//   the variable  `let`, `var`, a parameter, one with a default, one in a pattern, one that shares its value with `arguments`, of the head of a `for`, of a `for of`,
//                 of a `catch`, of a block in a loop, a member of an object or an element of a list that only the function and the closure hold
//   the closure   an arrow, a function, a bound function, an arrow out of an arrow, a setter, a method of a literal, of a class, an element of a list, a pattern, a generator, an async arrow,
//                 one that counts, one that adds, one that runs `eval`; made in the body or in a default of a parameter
//   the road out  it is yielded, stored to a variable outside, pushed into a list, handed to a function that came in, stored into an object that came in or into `this`
//   the reads     behind the suspension; on both sides of it in one call, list, template, sum, `+=`, `switch`; a test decided ahead of it and asked again; `typeof`; another closure; `finally`
//   the driver    `next`, `for of`, `for await`, a pattern, `return` and `throw` in the middle, a promise that it settles or rejects, the statement behind the call
//   what is stored  numbers of several kinds, a text, `null`, `undefined`, a list, a truth value
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const kind = random.weighted([
    [5, "generator"],
    [4, "async"],
    [2, "async generator"],
  ] as const);
  const yields = kind !== "async";
  const waits = kind !== "generator";
  const isModule = random.chance(0.5);

  const variable = random.weighted([
    [5, "let"],
    [2, "var"],
    [3, "parameter"],
    [2, "default"],
    [2, "pattern"],
    [2, "shared with arguments"],
    [3, "head of a for"],
    [2, "for of"],
    [2, "catch"],
    [2, "block in a loop"],
    [3, "member"],
    [2, "element"],
  ] as const);
  const sharesTheOtherWay = variable === "shared with arguments" && random.chance(0.5);
  // What the function reads and what the closure stores to.
  const V =
    variable === "member"
      ? "v.n"
      : variable === "element"
        ? "v[0]"
        : variable === "shared with arguments" && !sharesTheOtherWay
          ? "arguments[0]"
          : "v";
  const W = variable === "member" ? "v.n" : variable === "element" ? "v[0]" : sharesTheOtherWay ? "arguments[0]" : "v";

  const [closure, use] = random.weighted<[string, (held: string, value: string) => string]>([
    [4, [`x => {\n${W} = x;\n}`, (held, value) => `${held}(${value});`]],
    [2, [`x => (${W} = x)`, (held, value) => `${held}(${value});`]],
    ...(W === "arguments[0]"
      ? []
      : ([
          [2, [`function (x) {\n${W} = x;\n}`, (held, value) => `${held}(${value});`]],
          [1, [`function (x) {\n${W} = x;\n}.bind(null)`, (held, value) => `${held}(${value});`]],
          [2, [`{\nset put(x) {\n${W} = x;\n},\n}`, (held, value) => `${held}.put = ${value};`]],
          [2, [`{\nput(x) {\n${W} = x;\n},\n}`, (held, value) => `${held}.put(${value});`]],
          [1, [`new (class {\nput(x) {\n${W} = x;\n}\n})()`, (held, value) => `${held}.put(${value});`]],
          [1, [`function* (x) {\n${W} = x;\n}`, (held, value) => `${held}(${value}).next();`]],
        ] as [number, [string, (held: string, value: string) => string]][])),
    [2, [`() => ${W}++`, held => `${held}();`]],
    [2, [`() => {\n${W} += 10;\n}`, held => `${held}();`]],
    [1, [`[\nx => {\n${W} = x;\n},\n]`, (held, value) => `${held}[0](${value});`]],
    [1, [`(x => y => {\n${W} = y;\n})(0)`, (held, value) => `${held}(${value});`]],
    [1, [`x => {\n[${W}] = [x];\n}`, (held, value) => `${held}(${value});`]],
    [1, [`x => {\n({ x: ${W} } = { x });\n}`, (held, value) => `${held}(${value});`]],
    [1, [`async x => {\n${W} = x;\n}`, (held, value) => `${held}(${value});`]],
    // Plain Bun finds no `arguments` for a text that runs in a generator or an async function.
    ...(W === "arguments[0]"
      ? []
      : ([[1, [`x => eval("${W} = x")`, (held, value) => `${held}(${value});`]]] as [
          number,
          [string, (held: string, value: string) => string],
        ][])),
  ]);
  const value = random.pick(["5", "5", "2", '"t"', '"t"', "1.5", "null", "undefined", "[7]", "-0", "2 ** 31", "true"]);

  const inADefault =
    (variable === "parameter" || variable === "default" || variable === "pattern") && random.chance(0.3);
  const made = inADefault ? "made" : closure;

  const two = random.chance(0.15);
  const road = random.pick(
    yields
      ? (["yielded", "yielded", "yielded", "outside", "pushed", "handed", "box", "this"] as const)
      : (["outside", "outside", "pushed", "handed", "box", "this"] as const),
  );

  // How the function is suspended.
  const gate = waits && !yields && random.chance(0.4);
  const S = yields ? (road === "yielded" ? `(yield ${made})` : "(yield)") : gate ? "(await gate)" : "(await null)";
  const bare = S.slice(1, -1);
  const handsOut = {
    yielded: "",
    outside: `out = ${made};`,
    pushed: `sink.push(${made});`,
    handed: `give(${made});`,
    box: `box.set = ${made};`,
    this: `this.set = ${made};`,
  }[road];

  const forms: [number, boolean, string][] = [
    [4, false, `${bare};\nconsole.log(${V});`],
    [3, false, `console.log(${V}, ${S}, ${V});`],
    [2, false, `const all = [${V}, ${S}, ${V}];\nconsole.log(all.join());`],
    [3, false, `${V} += (${S}, 1);\nconsole.log(${V});`],
    [2, false, `${V} = ${V} + (${S}, 1);\nconsole.log(${V});`],
    [2, false, `console.log(\`\${${V}} \${${S}} \${${V}}\`);`],
    [3, false, `const before = ${V};\n${bare};\nconsole.log(before, ${V}, before === ${V});`],
    [3, false, `if (${V} === 1) {\n${bare};\nconsole.log(${V} === 1 ? "same" : "other");\n}`],
    [2, false, `for (let turn = 0; turn < 3 && ${V} === 1; turn++) {\n${bare};\n}\nconsole.log(${V});`],
    [2, false, `return [${V}, ${S}, ${V}];`],
    [3, false, `try {\n${bare};\n} finally {\nconsole.log("finally", ${V});\n}`],
    [2, false, `try {\n${bare};\n} catch (error) {\nconsole.log("caught", ${V});\n}\nconsole.log(${V});`],
    [2, false, `console.log(typeof ${V});\n${bare};\nconsole.log(typeof ${V});`],
    [2, false, `const read = () => ${V};\n${bare};\nconsole.log(read());`],
    [2, false, `console.log(${V} + 1);\n${bare};\nconsole.log(${V} + 1);`],
    [2, false, `${bare};\nreturn ${V};`],
    [2, false, `for (const each of [${V}, ${S}, ${V}]) console.log(each);`],
    [2, false, `switch (${V}) {\ncase 1:\n${bare};\ncase ${V}:\nconsole.log("falls", ${V});\n}`],
    [2, false, `${V}++;\n${bare};\n${V}++;\nconsole.log(${V});`],
    [1, false, `const sum = ${V} * 2 + (${S}, 0) + ${V} * 2;\nconsole.log(sum);`],
    [1, false, `console.log({ a: ${V}, b: ${S}, c: ${V} }.c);`],
    [1, false, `console.log(${V} === 1 && (${S}, ${V} === 1));`],
    ...(yields
      ? ([
          [3, true, `${bare};\nyield ${V};`],
          [2, true, `${bare};\nyield ${V};\nyield ${V};`],
        ] as [number, boolean, string][])
      : []),
  ];
  const [, yieldsMore, form] = random.weighted(forms.map(each => [each[0], each] as const));

  // The variable's declaration round the form.
  const parameters: string[] = [];
  const given: string[] = [];
  let opens = "";
  let closes = "";
  switch (variable) {
    case "let":
      opens = "let v = 1;";
      break;
    case "var":
      opens = "var v = 1;";
      break;
    case "parameter":
    case "shared with arguments":
      parameters.push("v");
      given.push("1");
      break;
    case "default":
      parameters.push("v = 1");
      break;
    case "pattern":
      if (random.chance(0.5)) (parameters.push("{ v }"), given.push("{ v: 1 }"));
      else (parameters.push("[v]"), given.push("[1]"));
      break;
    case "head of a for":
      opens = "for (let v = 1; v < 3; v++) {";
      closes = "}";
      break;
    case "for of":
      opens = "for (let v of [1, 1]) {";
      closes = "}";
      break;
    case "catch":
      opens = "try {\nthrow 1;\n} catch (v) {";
      closes = "}";
      break;
    case "block in a loop":
      opens = "for (const turn of [0, 1]) {\nlet v = 1;";
      closes = "}";
      break;
    case "member":
      opens = "const v = { n: 1 };";
      break;
    case "element":
      opens = "const v = [1];";
      break;
  }
  if (inADefault) {
    if (given.length < parameters.length) given.push("undefined");
    parameters.push(`made = ${closure}`);
  }
  const ahead = parameters.length;
  const instance = (index: number) => {
    const more = [...given];
    if (road === "handed" || road === "box") while (more.length < ahead) more.push("undefined");
    if (road === "handed") more.push(`made => {\nheld${index} = made;\n}`);
    if (road === "box") more.push(`box${index}`);
    return more.join(", ");
  };
  if (road === "handed") parameters.push("give");
  if (road === "box") parameters.push("box");

  const body = [opens, handsOut, form, closes].filter(Boolean).join("\n");
  const word = { generator: "function*", async: "async function", "async generator": "async function*" }[kind];
  const mark = { generator: "*", async: "async ", "async generator": "async *" }[kind];
  const isMethod = road === "this" || random.chance(0.15);
  const written = isMethod
    ? `const holder = {\n${mark}steps(${parameters.join(", ")}) {\n${body}\n},\n};`
    : `${word} steps(${parameters.join(", ")}) {\n${body}\n}`;
  const through = yields && random.chance(0.15);
  const started = (index: number) => {
    const direct = `${isMethod ? "holder." : ""}steps(${instance(index)})`;
    return through ? `(${word} () {\nreturn yield* ${direct};\n})()` : direct;
  };
  const reached = (index: number, first: string) =>
    ({
      yielded: first,
      outside: "out",
      pushed: `sink[${index}]`,
      handed: `held${index}`,
      box: `box${index}.set`,
      this: "holder.set",
    })[road];
  const around = [
    road === "outside" ? "let out;" : "",
    road === "pushed" ? "const sink = [];" : "",
    road === "handed" ? `let held0${two ? ", held1" : ""};` : "",
    road === "box" ? `const box0 = {}${two ? ", box1 = {}" : ""};` : "",
    gate
      ? "let open, fail;\nconst gate = new Promise((resolve, reject) => {\nopen = resolve;\nfail = reject;\n});"
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const declared = [around, written].filter(Boolean).join("\n");
  const w = waits ? "await " : "";
  const sent = random.pick(["", "", "", "3", '"sent"']);
  let driver: string;
  if (yields) {
    const way = random.weighted([
      [5, "next"],
      [(yieldsMore && road === "yielded") || variable === "head of a for" ? 0 : 3, "for of"],
      [2, "return"],
      [2, "throw"],
      [1, "pattern"],
      [two ? 6 : 0, "two"],
    ] as const);
    if (way === "for of")
      driver = `for ${waits ? "await " : ""}(const each of ${started(0)}) {\n${use(reached(0, "each"), value)}\n${random.chance(0.3) ? "break;\n" : ""}}`;
    else if (way === "pattern" && !waits)
      driver = `const [first] = ${started(0)};\n${use(reached(0, "first"), value)}\nconsole.log(typeof first);`;
    else if (way === "two")
      driver = [
        `const a = ${started(0)};`,
        `const b = ${started(1)};`,
        `const first = ${w}a.next();`,
        `const other = ${w}b.next();`,
        use(reached(random.below(2), random.pick(["first.value", "other.value"])), value),
        `console.log(JSON.stringify(${w}a.next(${sent})));`,
        `console.log(JSON.stringify(${w}b.next(${sent})));`,
      ].join("\n");
    else
      driver = [
        `const it = ${started(0)};`,
        `const first = ${w}it.next();`,
        use(reached(0, "first.value"), value),
        way === "return"
          ? `console.log(JSON.stringify(${w}it.return(9)));`
          : way === "throw"
            ? `console.log(JSON.stringify(${w}it.throw("thrown")));`
            : `console.log(JSON.stringify(${w}it.next(${sent})));`,
        random.chance(0.5) ? `console.log(JSON.stringify(${w}it.next()));` : "",
      ]
        .filter(Boolean)
        .join("\n");
  } else if (two && !gate) {
    driver = [
      `const a = ${started(0)};`,
      `const b = ${started(1)};`,
      use(reached(random.below(2), ""), value),
      "console.log(JSON.stringify(await a));",
      "console.log(JSON.stringify(await b));",
    ].join("\n");
  } else {
    driver = [
      `const later = ${started(0)};`,
      gate && random.chance(0.5) ? "await null;" : "",
      use(reached(0, ""), value),
      gate ? (random.chance(0.25) ? `fail("thrown");` : `open(${sent});`) : "",
      "console.log(JSON.stringify(await later));",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error?.constructor.name);\n}`;
  const file = isModule ? "main.mjs" : "main.cjs";
  const scene = guarded(driver);
  let place = random.pick(["top", "top", "once", "once", "thrice", "scene inside"] as const);
  if (waits && !isModule && place === "top") place = "once";
  const run = waits ? "async function run()" : "function run()";
  const runs = (times: number) =>
    waits
      ? isModule
        ? Array(times).fill("await run();").join("\n")
        : `run()${".then(run)".repeat(times - 1)};`
      : Array(times).fill("run();").join("\n");
  if (place === "top") return { file, text: `${declared}\n${scene}\n` };
  if (place === "scene inside") return { file, text: `${declared}\n${run} {\n${scene}\n}\n${runs(1)}\n` };
  return { file, text: `${run} {\n${declared}\n${scene}\n}\n${runs(place === "once" ? 1 : 3)}\n` };
}
