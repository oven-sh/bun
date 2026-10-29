// Small programs of a dozen functions. Each declares a variable, does something, and gives the variable back. The program writes down what was done and prints it behind each call, with what came back.
// Each function is called twice: the second time it leaves early wherever it can.
//
//   the value      what a build may know: a method or a member of a written text, a function of Math, a conversion, an operator on literals, a template, a choice between literals, a member of a written
//                  list or object, a literal, an enum member; and what it cannot: a call, a getter and a variable of the program
//   declared       with `const`, `let` or `var`; alone, beside another declarator, through a second name, by a pattern; first in its block, behind a constant, behind a statement; in the body, a block,
//                  a `try`, a loop, a `switch`
//   in between     nothing, a store, a call, a loop, an early `return`, a `throw`, a `try`, a declaration, a class with a static block, an `await`, a `yield`
//   given back     by `return` as it is, in brackets, behind a comma, under a cast, out of either arm of a choice, inside a larger expression, twice, out of a `try` or a `finally`, by `throw`; by an inner
//                  function, an arrow function, a getter or a static method that is called, or that nobody calls
//   by the build   with `flagsOfTheBuild`: a flag of "bun:bundle" that is on or off, or a name that the build defines, guards what stands in between, chooses the value, or chooses what the `return` gives;
//                  in between stands a call that the build drops, or one that is marked as pure, which `flagsOfABuildThatIgnoresMarks` keeps
//   in             a function, a function expression, an arrow function, a method, a static method, a getter, a callback of a built-in, an async function, a generator, an async generator
import type { Random } from "./random";

// "unchecked": TypeScript rejects the text. "no result": a getter that is checked must give something back. "stores": the variable is no constant.
type Needs = "async" | "generator" | "unchecked" | "no result" | "stores";
type Text = readonly [text: string, ...needs: Needs[]];

const knownInEveryDialect: readonly string[] = [
  `"abcdef".charCodeAt(3)`,
  `"abcdef".charCodeAt(0)`,
  `"abcdef".charCodeAt(5)`,
  `"abcdef".charCodeAt(6)`,
  `"abcdef".charCodeAt(-1)`,
  `"abcdef".charCodeAt(1.5)`,
  `'abcdef'.charCodeAt(2)`,
  "`abcdef`.charCodeAt(2)",
  `("abcdef").charCodeAt(4)`,
  `"abcdef"["charCodeAt"](1)`,
  `"abcdef".charCodeAt?.(1)`,
  `"abcdef"?.charCodeAt(1)`,
  `"a\\u00e9b".charCodeAt(1)`,
  `"a\\u{1f600}b".charCodeAt(1)`,
  `("abc" + "def").charCodeAt(3)`,
  `"abcdef".charCodeAt(1 + 2)`,
  `"abcdef".charCodeAt(3) + 1`,
  `-"abcdef".charCodeAt(3)`,
  `String.fromCharCode("abcdef".charCodeAt(3))`,
  `"abcdef".charAt(2)`,
  `"abcdef".at(-1)`,
  `"abcdef".indexOf("d")`,
  `"abcdef".lastIndexOf("d")`,
  `"abcdef".length`,
  `"abcdef"["length"]`,
  `"abcdef".codePointAt(1)`,
  `"abcdef".slice(1, 3)`,
  `"abcdef".substring(2)`,
  `"abcdef"[2]`,
  `"abcdef".toUpperCase()`,
  `"abcdef".concat("g")`,
  `"abcdef".includes("cd")`,
  `"abcdef".startsWith("ab")`,
  `"ab".repeat(2)`,
  `" ab ".trim()`,
  `"ab".padStart(4)`,
  `"a,b".split(",").length`,
  `"abcdef".replace("c", "C")`,
  `Math.max(1, 2)`,
  `Math.min(1, 2)`,
  `Math.floor(2.5)`,
  `Math.ceil(2.5)`,
  `Math.round(2.5)`,
  `Math.trunc(-1.5)`,
  `Math.abs(-3)`,
  `Math.sign(-2)`,
  `Math.pow(2, 3)`,
  `Math.sqrt(16)`,
  `Math.imul(3, 4)`,
  `Math.hypot(3, 4)`,
  `Math.clz32(1)`,
  `Math.PI`,
  `Number("12")`,
  `Number(true)`,
  `String(12)`,
  `Boolean(0)`,
  `BigInt(3)`,
  `parseInt("12px")`,
  `parseFloat("1.5")`,
  `Number.parseInt("7")`,
  `Number.isInteger(3)`,
  `Number.MAX_SAFE_INTEGER`,
  `isNaN(1)`,
  `Array.isArray([])`,
  `Object.is(1, 1)`,
  `JSON.stringify(1)`,
  `typeof "text"`,
  `void 0`,
  `!0`,
  `-1`,
  `-0`,
  `~5`,
  `1 + 2`,
  `7 % 4`,
  `2 ** 5`,
  `1 << 4`,
  `"a" + "b"`,
  `"a" + 1`,
  "`plain`",
  "`a${1}b`",
  '`a${"b"}c`',
  "String.raw`a${1}b`",
  `[1, 2][1]`,
  `[1, 2].length`,
  `({ a: 12 }).a`,
  `12n`,
  `null`,
  `undefined`,
  `NaN`,
  `Infinity`,
  `1e3`,
  `0x10`,
  `"text"`,
  `""`,
  `true`,
  `false`,
  `0`,
  `5`,
];

// TypeScript rejects these: most of them because it knows how they end.
const knownWhereNothingIsChecked: readonly string[] = [
  `typeof nobodyDeclaresThis`,
  `(0, 11)`,
  `"abcdef".charCodeAt()`,
  `"abcdef".charCodeAt("3")`,
  `"abcdef".charCodeAt(3, 4)`,
  `1 < 2`,
  `1 === 1`,
  `"a" === "b"`,
  `null ?? 5`,
  `6 ?? say("never")`,
  `0 || 7`,
  `1 && 8`,
  `0 && say("never")`,
  `1 || say("never")`,
  `true ? 9 : say("never")`,
  `false ? say("never") : 10`,
  `true ? "abcdef".charCodeAt(3) : say("never")`,
  `null ?? "abcdef".charCodeAt(3)`,
  `1 && "abcdef".charCodeAt(3)`,
  `(0, "abcdef".charCodeAt(3))`,
  `["abcdef".charCodeAt(3)][0]`,
  `!"abcdef".charCodeAt(3)`,
  `typeof "abcdef".charCodeAt(3)`,
  `void "abcdef".charCodeAt(3)`,
];

const knownInTypeScript: readonly string[] = [
  `Color.Green`,
  `Color["Green"]`,
  `Fixed.Second`,
  `Word.Yes`,
  `5 as number`,
  `<number>5`,
  `5 satisfies number`,
  `"abcdef".charCodeAt(3)!`,
  `"abcdef".charCodeAt(3) as number`,
  `"abcdef".charCodeAt(3) satisfies number`,
  `("abcdef" as string).charCodeAt(3)`,
  `"abcdef".charCodeAt(3 as number)`,
];

const unknown: readonly string[] = [
  `say("made")`,
  `say(1)`,
  `holder.got`,
  `holder.method()`,
  `count`,
  `count++`,
  `text.charCodeAt(3)`,
  `"abcdef".charCodeAt(three)`,
  `"abcdef".charCodeAt(say(3))`,
  `new Noted().kept`,
  `[say("in a list")][0]`,
  `(say("left"), "abcdef".charCodeAt(3))`,
];

export const flagsOfTheBuild = [
  "--feature=ON",
  "--define",
  "BUILD_ON=true",
  "--define",
  "BUILD_OFF=false",
  "--define",
  'process.env.CHANNEL="public"',
  "--drop=dropped",
];

export const flagsOfABuildThatIgnoresMarks = [...flagsOfTheBuild, "--ignore-dce-annotations"];

const chosenByTheBuild: readonly string[] = [
  `feature("ON") ? say("made") : null`,
  `feature("OFF") ? say("made") : null`,
  `feature("ON") ? null : say("made")`,
  `feature("OFF") ? null : say("made")`,
  `feature("ON") ? say("made") : false`,
  `feature("ON") ? say("made") : -1`,
  `feature("ON") ? say("made") : ""`,
  `feature("ON") ? say("made") : undefined`,
  `feature("ON") ? say("made") : []`,
  `feature("ON") ? say("made") : count`,
  `feature("ON") ? say("made") : say("other")`,
  `feature("OFF") ? say("other") : say("made")`,
  `feature("ON") ? "abcdef".charCodeAt(3) : say("made")`,
  `BUILD_ON ? say("made") : null`,
  `BUILD_OFF ? say("made") : null`,
  `BUILD_OFF ? null : say("made")`,
  `BUILD_ON && say("made")`,
  `BUILD_OFF || say("made")`,
  `BUILD_ON`,
  `process.env.CHANNEL`,
  `process.env.CHANNEL === "public" ? say("made") : null`,
];

const betweenByTheBuild: readonly Text[] = [
  [`if (feature("ON")) count++;`],
  [`if (feature("ON")) {\ncount++;\n}`],
  [`if (feature("OFF")) count++;`],
  [`if (feature("OFF")) {\ncount++;\n}`],
  [`if (feature("OFF")) {\nsay("never");\n} else {\nsay("off");\n}`],
  [`if (feature("ON")) {\nsay("on");\n} else {\nsay("never");\n}`],
  [`if (!feature("OFF")) say("not off");`],
  [`if (!feature("ON")) say("never");`],
  [`if (feature("ON")) return "early";`],
  [`if (feature("OFF")) return "never";`],
  [`if (feature("ON")) throw new Error("thrown");`],
  [`if (feature("OFF")) throw new Error("never");`],
  [`if (feature("ON")) held = "stored";`],
  [`if (feature("ON")) holder.kept = count + 1;`],
  [`if (feature("ON")) c = say("changed");`, "stores"],
  [`if (feature("OFF")) c = say("never");`, "stores"],
  [`if (feature("ON")) {\nif (flag) return "early";\n}`],
  [`feature("ON") ? say("on") : say("never");`],
  [`feature("OFF") ? say("never") : say("off");`],
  [`if (BUILD_ON) count++;`],
  [`if (BUILD_OFF) count++;`],
  [`if (BUILD_ON) return "early";`],
  [`if (BUILD_OFF) return "never";`],
  [`if (!BUILD_OFF) say("not off");`],
  [`if (BUILD_ON) c = say("changed");`, "stores"],
  [`BUILD_ON && say("on");`],
  [`BUILD_OFF || say("off");`],
  [`if (process.env.CHANNEL === "public") count++;`],
  [`if (process.env.CHANNEL !== "public") say("never");`],
  [`if (typeof BUILD_ON === "boolean") count++;`],
  [`/* @__PURE__ */ say("marked as pure");`],
  [`/* @__PURE__ */ holder.method();`],
  [`/* @__PURE__ */ new Noted();`],
  [`/* @__PURE__ */ (() => say("marked as pure"))();`],
  [`dropped("dropped");`],
  [`dropped(say("an argument of what is dropped"));`],
];

const returnsByTheBuild: readonly Text[] = [
  [`return feature("ON") ? say(c) : c;`],
  [`return feature("OFF") ? say(c) : c;`],
  [`return feature("ON") ? c : say(c);`],
  [`return feature("OFF") ? c : say(c);`],
  [`return feature("ON") ? [c] : c;`],
  [`return feature("ON") ? "on" : c;`],
  [`if (feature("ON")) return say(c);\nreturn c;`],
  [`if (feature("OFF")) return say(c);\nreturn c;`],
  [`if (feature("ON")) {\nsay("on");\n}\nreturn c;`],
  [`if (feature("ON")) {\nreturn c;\n} else {\nreturn say(c);\n}`],
  [`return BUILD_ON ? say(c) : c;`],
  [`return BUILD_OFF ? say(c) : c;`],
  [`return BUILD_ON && c;`],
  [`return BUILD_OFF || c;`],
  [`return process.env.CHANNEL === "public" ? say(c) : c;`],
];

const declarations: readonly ((keyword: string, value: string, type: string) => string)[] = [
  (keyword, value, type) => `${keyword} c${type} = ${value};`,
  (keyword, value, type) => `${keyword} c${type} = ${value};`,
  (keyword, value, type) => `${keyword} c${type} = ${value};`,
  (keyword, value, type) => `${keyword} c${type} = (${value});`,
  (keyword, value, type) => `${keyword} other = 1, c${type} = ${value};`,
  (keyword, value, type) => `${keyword} c${type} = ${value}, other = 1;`,
  (keyword, value, type) => `${keyword} c${type} = ${value}, other = say("beside");`,
  (keyword, value, type) => `${keyword} first${type} = ${value};\n${keyword} c${type} = first;`,
  (keyword, value) => `${keyword} first = ${value}, c = first;`,
  (keyword, value) => `${keyword} first = ${value};\nsay("between the names");\n${keyword} c = first;`,
  (keyword, value) => `${keyword} first = ${value};\n${keyword} second = first;\n${keyword} c = second;`,
  (keyword, value) => `${keyword} [c] = [${value}];`,
  (keyword, value) => `${keyword} { c } = { c: ${value} };`,
];

const fronts: readonly string[] = [
  ``,
  ``,
  ``,
  ``,
  `const before = 1;\n`,
  `const before = "abcdef".charCodeAt(1);\n`,
  `const before = 1;\nsay(before);\n`,
  `say("before");\n`,
  `let before = say("before");\n`,
  `var before;\n`,
  `"use strict";\n`,
  `;\n`,
  `function hoisted() {}\n`,
];

const between: readonly Text[] = [
  [``],
  [`count++;`],
  [`count++;`],
  [`count += 2;`],
  [`held = "stored";`],
  [`holder.kept = count;`],
  [`say("between");`],
  [`say("between");`],
  [`void say("between");`],
  [`holder.method();`],
  [`holder.got;`],
  [`new Noted();`],
  [`delete holder.gone;`],
  ["tag`text`;"],
  [`for (let i = 0; i < 3; i++) say(i);`],
  [`for (const each of [1, 2]) count += each;`],
  [`for (const key in { a: 1, b: 2 }) say(key);`],
  [`while (count < 3) count++;`],
  [`do count++; while (count < 2);`],
  [`if (flag) return 0;`],
  [`if (flag) return "early";`],
  [`if (flag) return;`],
  [`if (flag) throw new Error("thrown");`],
  [`if (!flag) say("not early"); else return "early";`],
  [`if (flag) say("late");`],
  [`throw new Error("always");`, "no result"],
  [`try {\nsay("tried");\n} finally {\nsay("finally");\n}`],
  [`try {\nthrow new Error("inside");\n} catch (caught) {\nsay("caught");\n}`],
  [`{\nsay("in a block");\n}`],
  [`out: {\nif (flag) break out;\nsay("in a labeled block");\n}`],
  [`switch (count) {\ncase 0:\nsay("zero");\nbreak;\ndefault:\nsay("more");\n}`],
  [`const another = say("another");`],
  [`const another = say("another");\nsay(another);`],
  [`let another = 1;\nanother++;\nsay(another);`],
  [`const another = 2;`],
  [`const another = 2;\nsay(another);`],
  [`function inner() {\nsay("in a function");\n}\ninner();`],
  [`function inner() {\nsay("never");\n}`],
  [`class Inner {\nstatic {\nsay("in a static block");\n}\n}`],
  [`(() => say("in an arrow"))();`],
  [`[1, 2].forEach(each => say(each));`],
  [`;`],
  [`"a text";`],
  [`say("one");\nsay("two");\ncount++;`],
  [`await null;\nsay("behind an await");`, "async"],
  [`await say("awaited");`, "async"],
  [`for await (const each of [1, 2]) say(each);`, "async"],
  [`yield "yielded";`, "generator"],
  [`say(yield "asked");`, "generator", "unchecked"],
  [`yield* ["one", "two"];`, "generator"],
];

const returns: readonly Text[] = [
  [`return c;`],
  [`return c;`],
  [`return c;`],
  [`return c;`],
  [`return (c);`],
  [`return ((c));`],
  [`return (0, c);`, "unchecked"],
  [`return [c][0];`],
  [`return flag ? c : c;`],
  [`return flag ? "early" : c;`],
  [`return c, c;`, "unchecked"],
  [`return c;\nreturn c;`],
  [`return c;\nsay("never");`],
  [`if (flag) return c;\nsay("behind the first");\nreturn c;`],
  [`if (flag) {\nreturn c;\n} else {\nsay("in the other arm");\nreturn c;\n}`],
  [`{\nreturn c;\n}`],
  [`do {\nreturn c;\n} while (flag);`],
  [`switch (count) {\ndefault:\nreturn c;\n}`],
  [`try {\nreturn c;\n} finally {\nsay("finally");\n}`],
  [`try {\nsay("tried");\n} finally {\nreturn c;\n}`],
  [`try {\nthrow new Error("inside");\n} catch {\nreturn c;\n}`],
  [`throw c;`, "no result"],
  [`return [c, c].join();`],
  [`return c + "";`],
  [`return typeof c;`],
  [`return { c }.c;`],
  [`return say(c);`],
  [`return String(c);`],
  [`held = c;\nreturn held;`],
  [`const last = c;\nreturn last;`],
  [`const last = c;\nsay("behind the last name");\nreturn last;`],
  [`const g = () => c;\nsay("after");\nreturn g();`],
  [`const g = () => c;\nsay("after");\nreturn 2;`],
  [`const g = () => c;\nreturn g;`],
  [`const g = () => {\nreturn c;\n};\nsay("after");\nreturn g();`],
  [`const g = () => {\nreturn c;\n};\nsay("after");\nreturn 2;`],
  [`const g = function () {\nreturn c;\n};\nsay("after");\nreturn 2;`],
  [`function g() {\nreturn c;\n}\nsay("after");\nreturn g();`],
  [`function g() {\nreturn c;\n}\nsay("after");\nreturn 2;`],
  [`const made = {\nget got() {\nreturn c;\n},\n};\nsay("after");\nreturn made.got;`],
  [`const made = {\nget got() {\nreturn c;\n},\n};\nsay("after");\nreturn 2;`],
  [`const made = {\nmethod() {\nreturn c;\n},\n};\nsay("after");\nreturn made.method();`],
  [`class Made {\nstatic method() {\nreturn c;\n}\n}\nsay("after");\nreturn Made.method();`],
  [`class Made {\nstatic method() {\nreturn c;\n}\n}\nsay("after");\nreturn 2;`],
  [`return (() => c)();`],
  [`return (() => {\nsay("inside");\nreturn c;\n})();`],
  [`return (function () {\nreturn c;\n})();`],
  [`return [0].map(() => c)[0];`],
  [`say("after");`, "no result"],
  [`say(c);`, "no result"],
  [`return await c;`, "async"],
  [`await null;\nreturn c;`, "async"],
  [`const g = async () => c;\nsay("after");\nreturn g();`, "async"],
  [`yield c;\nreturn c;`, "generator"],
  [`yield c;`, "generator"],
  [`return yield c;`, "generator", "unchecked"],
];

const returnsUnderCasts: readonly Text[] = [[`return c as unknown;`], [`return c!;`], [`return <unknown>c;`]];

const blocks: readonly ((body: string) => string)[] = [
  body => body,
  body => body,
  body => body,
  body => body,
  body => `{\n${body}\n}`,
  body => `if (count === 0) {\n${body}\n}`,
  body => `try {\n${body}\n} finally {\nsay("left the try");\n}`,
  body => `try {\n${body}\n} catch (caught) {\nsay("caught in the function");\nthrow caught;\n}`,
  body => `for (;;) {\n${body}\nbreak;\n}`,
  body => `for (const turn of [1, 2]) {\n${body}\n}`,
  body => `switch (0) {\ncase 0: {\n${body}\n}\n}`,
  body => `say("ahead of the block");\n{\n${body}\n}`,
];

type Kind = {
  has?: readonly Needs[];
  isGetter?: true;
  declare: (name: string, body: string) => string;
  call: (name: string) => string;
};

const kinds: readonly Kind[] = [
  { declare: (name, body) => `function ${name}() {\n${body}\n}`, call: name => `${name}()` },
  { declare: (name, body) => `function ${name}() {\n${body}\n}`, call: name => `${name}()` },
  { declare: (name, body) => `const ${name} = function () {\n${body}\n};`, call: name => `${name}()` },
  { declare: (name, body) => `const ${name} = () => {\n${body}\n};`, call: name => `${name}()` },
  { declare: (name, body) => `const ${name} = {\nmethod() {\n${body}\n},\n};`, call: name => `${name}.method()` },
  {
    isGetter: true,
    declare: (name, body) => `const ${name} = {\nget got() {\n${body}\n},\n};`,
    call: name => `${name}.got`,
  },
  { declare: (name, body) => `class ${name} {\nmethod() {\n${body}\n}\n}`, call: name => `new ${name}().method()` },
  { declare: (name, body) => `class ${name} {\nstatic method() {\n${body}\n}\n}`, call: name => `${name}.method()` },
  {
    isGetter: true,
    declare: (name, body) => `class ${name} {\nget got() {\n${body}\n}\n}`,
    call: name => `new ${name}().got`,
  },
  {
    declare: (name, body) => `function ${name}() {\nreturn [0].map(() => {\n${body}\n})[0];\n}`,
    call: name => `${name}()`,
  },
  {
    declare: (name, body) => `function ${name}() {\nfunction nested() {\n${body}\n}\nreturn nested();\n}`,
    call: name => `${name}()`,
  },
  { has: ["async"], declare: (name, body) => `async function ${name}() {\n${body}\n}`, call: name => `${name}()` },
  { has: ["async"], declare: (name, body) => `const ${name} = async () => {\n${body}\n};`, call: name => `${name}()` },
  {
    has: ["async"],
    declare: (name, body) => `const ${name} = {\nasync method() {\n${body}\n},\n};`,
    call: name => `${name}.method()`,
  },
  { has: ["generator"], declare: (name, body) => `function* ${name}() {\n${body}\n}`, call: name => `${name}()` },
  {
    has: ["generator"],
    declare: (name, body) => `const ${name} = {\n*method() {\n${body}\n},\n};`,
    call: name => `${name}.method()`,
  },
  {
    has: ["async", "generator"],
    declare: (name, body) => `async function* ${name}() {\n${body}\n}`,
    call: name => `${name}()`,
  },
];

function pickFor(random: Random, has: readonly Needs[], texts: readonly Text[]) {
  return random.pick(texts.filter(([, ...needs]) => needs.every(need => has.includes(need))))[0];
}

export type Dialect = "module" | "commonjs" | "typescript" | "typescript that nobody checks";

export function generate(random: Random, dialect: Dialect, isBuiltWithFlags = false) {
  const typed = dialect.startsWith("typescript");
  const checked = dialect === "typescript";
  const known = [
    ...knownInEveryDialect,
    ...(typed ? knownInTypeScript : []),
    ...(checked ? [] : knownWhereNothingIsChecked),
  ];
  const functions: string[] = [];
  const calls: string[] = [];
  for (let index = 0; index < 12; index++) {
    const kind = random.pick(kinds);
    const has: Needs[] = [...(kind.has ?? [])];
    if (!checked) has.push("unchecked");
    if (!checked || !kind.isGetter) has.push("no result");
    const value = isBuiltWithFlags
      ? random.pick(random.weighted([[5, unknown], [3, chosenByTheBuild], [2, known]])) // prettier-ignore
      : random.chance(0.35)
        ? random.pick(known.filter(text => text.includes("charCodeAt")))
        : random.chance(0.85)
          ? random.pick(known)
          : random.pick(unknown);
    const drawnKeyword = random.weighted([
      [6, "const"],
      [2, "let"],
      [1, "var"],
    ]);
    // A variable that begins as nothing has no type that an inner function could read.
    const keyword = checked && /^(?:null|undefined|void 0)$/.test(value) ? "const" : drawnKeyword;
    if (keyword !== "const") has.push("stores");
    const type = !typed || random.chance(0.6) ? "" : /^"abcdef"\.charCodeAt\(\d\)$/.test(value) ? ": number" : ": any";
    const numberOfSteps = random.weighted([
      [1, 0],
      [6, 1],
      [2, 2],
    ]);
    const steps = Array.from({ length: numberOfSteps }, (_, step) =>
      pickFor(random, has, isBuiltWithFlags && random.chance(0.7) ? betweenByTheBuild : between).replace(
        /\b(?:another|inner|Inner)\b/g,
        name => name + step,
      ),
    );
    const body = [
      random.pick(fronts) + random.pick(declarations)(keyword, value, type),
      ...steps.filter(step => step),
      pickFor(
        random,
        has,
        isBuiltWithFlags && random.chance(0.3)
          ? returnsByTheBuild
          : typed && random.chance(0.15)
            ? returnsUnderCasts
            : returns,
      ),
    ].join("\n");
    const name = `Case${index}`;
    functions.push(kind.declare(name, random.pick(blocks)(body)));
    calls.push(`await show("${index}", () => ${kind.call(name)});`);
  }
  const any = typed ? ": any" : "";
  return {
    file: typed ? "main.ts" : dialect === "commonjs" ? "main.cjs" : "main.mjs",
    text: `${typed && !checked ? "// @ts-nocheck\n" : ""}${isBuiltWithFlags ? `import { feature } from "bun:bundle";\n` : ""}${isBuiltWithFlags && typed ? "declare const BUILD_ON: boolean;\ndeclare const BUILD_OFF: boolean;\n" : ""}${typed ? `enum Color {\nRed,\nGreen,\n}\nconst enum Fixed {\nFirst = 10,\nSecond,\n}\nenum Word {\nYes = "yes",\n}\n` : ""}let log${typed ? ": string[]" : ""} = [];
let count = 0;
let held${any};
let flag = false;
let three = 3;
let text = "abcdef";
function say(what${any})${any} {
log.push(String(what));
return what;
}
function dropped(what${any}) {
log.push("not dropped: " + what);
}
function tag(parts${any}) {
log.push("tagged " + parts[0]);
}
class Noted {
kept = say("constructed");
}
const holder${any} = {
gone: 1,
get got() {
return say("got");
},
method() {
return say("method");
},
};
function describe(value${any})${typed ? ": string" : ""} {
if (typeof value === "function") return "function that gives " + describe(value());
if (value instanceof Error) return "error " + value.message;
return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
async function finish(value${any}) {
if (value === null || typeof value !== "object" || typeof value.next !== "function") return await value;
for (let sent = 0; ; sent++) {
const step = await value.next(sent);
if (step.done) return step.value;
log.push("yielded " + describe(step.value));
}
}
async function show(name${typed ? ": string" : ""}, run${any}) {
for (flag of [false, true]) {
log = [];
count = 0;
held = undefined;
holder.gone = 1;
let answer;
try {
answer = "gives " + describe(await finish(run()));
} catch (caught) {
answer = "throws " + describe(caught);
}
console.log(name, flag, answer, "|", log.join(", "), "|", count, describe(held));
}
}
${functions.join("\n")}
(async () => {
${calls.join("\n")}
})();
`,
  };
}
