// Small programs about one thing that is made in three steps, one of which throws, and a handler that reads what is there by then, by one road. The steps ahead of the throw have happened, the
// steps behind it have not. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the thing    an object filled by stores, a literal and stores, a whole literal, an instance whose constructor stores, whose fields have values, below another class, a list filled by `push`,
//                by index or written whole, an inner object, a `Map`, variables, a counter, a text, an object that a closure counts in; filled by `Object.assign`, a spread, patterns, a loop
//                over names, callbacks of `forEach`, `map` and `Array.from`, `Object.defineProperties`; frozen in the middle; made by a generator or an async function in three stretches
//   the throw    a function that throws at a step which the caller chooses, or an expression that always throws: a member of `null`, a call of `undefined`, a name that nobody declares, a
//                number added to a BigInt, a length below zero, a text that is no JSON, a symbol in a product, `in` and `instanceof` on a number, a spread of a number, `throw` in an arrow
//   the road     the variable that holds the thing, a variable outside that was stored to first, a closure, what is thrown carries it, `finally`, the statement behind the handler, a handler
//                in the caller
//   how often    once, or four times with the throw at another step each time and at none
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const isChosen = random.chance(0.55);
  const when = random.between(1, 3);
  const thrown = random.pick([
    "null.x",
    "undefined()",
    "(void 0).y.z",
    "nobodyDeclaresThis",
    "1n + 1",
    "new Array(-1)",
    'JSON.parse("{")',
    "Symbol() * 2",
    '"x" in 1',
    "({}) instanceof 1",
    "[...1]",
    '(() => {\nthrow new Error("boom");\n})()',
    'decodeURIComponent("%")',
    '"a".repeat(-1)',
    "(1).toFixed(101)",
    "BigInt(1.5)",
    'new (class {\nconstructor() {\nthrow new RangeError("boom");\n}\n})()',
    "null[Symbol.iterator]",
    "structuredClone(() => {})",
  ]);
  const carries = random.chance(0.12) && isChosen;
  const plain = (i: number) => random.pick([`${i}`, `${i}`, `${i}.5`, `"v${i}"`, `[${i}]`]);
  const values = [plain(1), plain(2), plain(3)];
  const E = (i: number, thing = "o") =>
    isChosen ? (carries ? `at(${i}, ${thing})` : `at(${i})`) : i === when ? thrown : values[i - 1];

  type Birth = { outside?: string; ahead: string; inside: string; shown: string; thing?: string; isAClass?: boolean };
  const births: [number, () => Birth][] = [
    [
      5,
      () => ({
        ahead: "const o = {};",
        inside: `o.a = ${E(1)};\no.b = ${E(2)};\no.c = ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      3,
      () => ({
        ahead: "let o;",
        inside: `o = { a: ${E(1, "null")} };\no.b = ${E(2)};\no.c = ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      3,
      () => ({
        ahead: 'let o = "nothing yet";',
        inside: `o = { a: ${E(1, "null")}, b: ${E(2, "null")}, c: ${E(3, "null")} };`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      4,
      () => ({
        outside: `let held = null;\nclass K {\nconstructor() {\nheld = this;\nthis.a = ${E(1, "this")};\nthis.b = ${E(2, "this")};\nthis.c = ${E(3, "this")};\n}\n}`,
        ahead: "",
        inside: "new K();",
        shown: "JSON.stringify(held)",
        thing: "held",
        isAClass: true,
      }),
    ],
    [
      3,
      () => ({
        outside: `let held = null;\nclass Above {\nconstructor() {\nheld = this;\n}\n}\nclass K extends Above {\na = ${E(1, "this")};\nb = ${E(2, "this")};\nc = ${E(3, "this")};\n}`,
        ahead: "",
        inside: "new K();",
        shown: "JSON.stringify(held)",
        thing: "held",
        isAClass: true,
      }),
    ],
    [
      2,
      () => ({
        outside: `let held = null;\nclass Above {\nconstructor() {\nheld = this;\nthis.a = ${E(1, "this")};\n}\n}\nclass K extends Above {\nb = ${E(2, "this")};\nconstructor() {\nsuper();\nthis.c = ${E(3, "this")};\n}\n}`,
        ahead: "",
        inside: "new K();",
        shown: "JSON.stringify(held)",
        thing: "held",
        isAClass: true,
      }),
    ],
    [
      2,
      () => ({
        outside: `let held = null;\nfunction K() {\nheld = this;\nthis.a = ${E(1, "this")};\nthis.b = ${E(2, "this")};\nthis.c = ${E(3, "this")};\n}`,
        ahead: "",
        inside: "new K();",
        shown: "JSON.stringify(held)",
        thing: "held",
        isAClass: true,
      }),
    ],
    [
      3,
      () => ({
        ahead: "const o = [];",
        inside: `o.push(${E(1)});\no.push(${E(2)});\no.push(${E(3)});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = [];",
        inside: `o[0] = ${E(1)};\no[1] = ${E(2)};\no[2] = ${E(3)};`,
        shown: "JSON.stringify(o) + o.length",
      }),
    ],
    [
      1,
      () => ({
        ahead: "const o = [];",
        inside: `o[2] = ${E(1)};\no[1] = ${E(2)};\no[0] = ${E(3)};`,
        shown: "JSON.stringify(o) + o.length",
      }),
    ],
    [
      2,
      () => ({
        ahead: "let o = null;",
        inside: `o = [${E(1, "null")}, ${E(2, "null")}, ${E(3, "null")}];`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = { inner: {} };",
        inside: `o.inner.a = ${E(1)};\no.inner.b = ${E(2)};\no.c = ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = new Map();",
        inside: `o.set("a", ${E(1)});\no.set("b", ${E(2)});\no.set("c", ${E(3)});`,
        shown: "JSON.stringify([...o])",
      }),
    ],
    [
      3,
      () => ({
        ahead: "let a = 0,\nb = 0,\nc = 0;",
        inside: `a = ${E(1, "null")};\nb = ${E(2, "null")};\nc = ${E(3, "null")};`,
        shown: "JSON.stringify([a, b, c])",
      }),
    ],
    [
      3,
      () => ({
        ahead: "let n = 0;",
        inside: `n++;\n${E(1, "null")};\nn++;\n${E(2, "null")};\nn++;\n${E(3, "null")};\nn++;`,
        shown: "n",
      }),
    ],
    [
      2,
      () => ({
        ahead: 'let text = "";',
        inside: `text += "a";\n${E(1, "null")};\ntext += "b";\n${E(2, "null")};\ntext += "c";\n${E(3, "null")};\ntext += "d";`,
        shown: "text",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = { n: 0 };\nconst add = () => o.n++;",
        inside: `add();\n${E(1)};\nadd();\n${E(2)};\nadd();\n${E(3)};`,
        shown: "o.n",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `Object.assign(\no,\n{\nget a() {\nreturn ${E(1)};\n},\n},\n{\nget b() {\nreturn ${E(2)};\n},\n},\n{\nget c() {\nreturn ${E(3)};\n},\n},\n);`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `Object.assign(o, {\nget a() {\nreturn ${E(1)};\n},\nget b() {\nreturn ${E(2)};\n},\nget c() {\nreturn ${E(3)};\n},\n});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `({ a: o.a = ${E(1)}, b: o.b = ${E(2)}, c: o.c = ${E(3)} } = {});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `[o.a = ${E(1)}, o.b = ${E(2)}, o.c = ${E(3)}] = [];`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      1,
      () => ({
        ahead: "const o = {};",
        inside: `[o.a, o.b, o.c] = [${E(1)}, ${E(2)}, ${E(3)}];`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `Object.defineProperties(o, {\na: { value: ${E(1)}, enumerable: true },\nb: { value: ${E(2)}, enumerable: true },\nc: { value: ${E(3)}, enumerable: true },\n});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      1,
      () => ({
        ahead: "const o = {};",
        inside: `Object.defineProperties(o, {\na: { value: 1, enumerable: true },\nb: {\nget value() {\nreturn ${E(2)};\n},\nenumerable: true,\n},\n});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `o.a = ${E(1)};\nObject.freeze(o);\no.b = ${E(2)};\no.c = ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      1,
      () => ({
        ahead: "const o = { a: 0, b: 0, c: 0 };",
        inside: `o.a = ${E(1)};\ndelete o.b;\no.c = ${E(2)};\no.b = ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      1,
      () => ({
        ahead: "const o = { a: 0.5, b: 0.5, c: 0.5 };",
        inside: `o.a += ${E(1)};\no.b += ${E(2)};\no.c += ${E(3)};`,
        shown: "JSON.stringify(o)",
      }),
    ],
  ];
  const chosenOnly: [number, () => Birth][] = [
    [
      3,
      () => ({
        ahead: "const o = {};\nlet step = 0;",
        inside: `for (const key of ["a", "b", "c"]) o[key] = ${carries ? "at(++step, o)" : "at(++step)"};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `[1, 2, 3].forEach(step => {\no["k" + step] = ${carries ? "at(step, o)" : "at(step)"};\n});`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = [];",
        inside: `[1, 2, 3].map(step => o.push(${carries ? "at(step, o)" : "at(step)"}));`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = [];",
        inside: `Array.from({ length: 3 }, (unused, index) => (o[index] = ${carries ? "at(index + 1, o)" : "at(index + 1)"}));`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      2,
      () => ({
        ahead: "const o = {};",
        inside: `for (let step = 1; step <= 3; step++) o["k" + step] = ${carries ? "at(step, o)" : "at(step)"};`,
        shown: "JSON.stringify(o)",
      }),
    ],
    [
      1,
      () => ({
        ahead: "let sum = 0;",
        inside: `for (let step = 1; step <= 3; step++) sum += ${carries ? "at(step, null)" : "at(step)"};`,
        shown: "sum",
      }),
    ],
  ];
  const birth = random.weighted(isChosen ? [...births, ...chosenOnly] : births)();
  const thing = birth.thing ?? (/\bconst o\b|\blet o\b/.test(birth.ahead) ? "o" : "");

  const road = carries
    ? "carried"
    : random.weighted([
        [5, "variable"],
        [thing === "o" && birth.ahead.startsWith("const o") ? 3 : 0, "outside"],
        [thing === "o" && birth.ahead.startsWith("const o") ? 2 : 0, "closure"],
        [3, "finally"],
        [3, "behind"],
        [3, "caller"],
      ] as const);

  const name = "error?.constructor?.name ?? typeof error";
  let shown = birth.shown;
  let ahead = birth.ahead;
  let outside = birth.outside ?? "";
  if (road === "outside") {
    outside = [outside, "let kept = null;"].filter(Boolean).join("\n");
    ahead += "\nkept = o;";
    shown = shown.replaceAll(/\bo\b/g, "kept");
  } else if (road === "closure") {
    outside = [outside, "let peek = null;"].filter(Boolean).join("\n");
    ahead += "\npeek = () => o;";
    shown = shown.replaceAll(/\bo\b/g, "peek()");
  } else if (road === "carried") shown = "JSON.stringify(error.partial)";

  const body =
    road === "finally"
      ? `${ahead}\ntry {\ntry {\n${birth.inside}\n} finally {\nconsole.log("finally", ${shown});\n}\n} catch (error) {\nconsole.log("caught", ${name});\n}`
      : road === "behind"
        ? `${ahead}\ntry {\n${birth.inside}\n} catch (error) {\nconsole.log("caught", ${name});\n}\nconsole.log("behind", ${shown});`
        : road === "caller"
          ? ""
          : `${ahead}\ntry {\n${birth.inside}\nconsole.log("whole", ${road === "carried" ? birth.shown : shown});\n} catch (error) {\nconsole.log("caught", ${name}, ${shown});\n}`;

  const at = isChosen
    ? carries
      ? 'let when = 0;\nfunction at(step, partial) {\nif (step === when) throw Object.assign(new Error("boom"), { partial });\nreturn step;\n}'
      : `let when = 0;\nfunction at(step) {\nif (step === when) throw new Error("boom");\nreturn ${random.pick(["step", "step", "step + 0.5", '"v" + step'])};\n}`
    : "";
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const turns = isChosen
    ? random.pick([[when], [when], [1, 2, 3, 0], [0, 3, 2, 1], [0, 0, when]])
    : random.pick([[0], [0], [0, 0, 0]]);
  const calls = (call: string) => turns.map(turn => (isChosen ? `when = ${turn};\n${call}` : call)).join("\n");

  if (road === "caller") {
    // The thing lies in variables outside the function that fills it, and the handler stands round the call.
    const declared = ahead.replace(/^const /gm, "let ");
    const resets = declared.replace(/^let /gm, "").replace(/,\n/g, ";\n");
    return {
      file,
      text:
        [
          at,
          outside,
          declared,
          `function fill() {\n${birth.inside}\n}`,
          calls(
            `${resets && turns.length > 1 ? resets + "\n" : ""}try {\nfill();\nconsole.log("whole", ${shown});\n} catch (error) {\nconsole.log("caught", ${name}, ${shown});\n}`,
          ),
        ]
          .filter(Boolean)
          .join("\n") + "\n",
    };
  }
  const place = turns.length > 1 ? "function" : random.pick(["top", "function", "function"] as const);
  if (place === "top")
    return { file, text: [at, outside, isChosen ? `when = ${turns[0]};` : "", body].filter(Boolean).join("\n") + "\n" };
  return {
    file,
    text: [at, outside, `function run() {\n${body}\n}`, calls("run();")].filter(Boolean).join("\n") + "\n",
  };
}
