// A function takes a piece out of a string (slice, substring, substr, at, charAt, an index, trim, split, a match, a replacement), carries it round a
// loop of some kind, where it may be taken again, swapped with another piece, shortened or kept in a list, and then returns, indexes, measures,
// compares, joins or hands it on. The caller does the same with what it gets. The second argument says whether the program has types.
import type { Random } from "./random";

export function generate(random: Random, isTyped = false): string {
  const t = (type: string) => (isTyped ? `: ${type}` : "");
  const number = () =>
    random
      .pick([
        "0",
        "1",
        "2",
        "3",
        "-1",
        "-2",
        "n",
        "n + 1",
        "n & 1",
        "k",
        "100",
        "base.length - 1",
        "base.length",
        "undefined as any",
        "1.5",
        "NaN",
      ])
      .replace(" as any", isTyped ? " as any" : "");
  const source = () =>
    random.pick([
      `"ab"`,
      `"abcdef"`,
      `base`,
      `base`,
      `base + "xy"`,
      `text`,
      `(base + text)`,
      `String(n * 1000 + 123)`,
      "`<${base}>`",
      `"  padded  "`,
      `"a,b,c,d"`,
      `"é中😀z"`,
      `""`,
      `words[n & 3]`,
      `base.toUpperCase()`,
    ]);
  const piece = (of: string) =>
    random.pick([
      `${of}.slice(${number()})`,
      `${of}.slice(${number()}, ${number()})`,
      `${of}.substring(${number()})`,
      `${of}.substring(${number()}, ${number()})`,
      `${of}.substr(${number()}, ${number()})`,
      `(${of}.at(${number()}) ?? "none")`,
      `${of}.charAt(${number()})`,
      `(${of}[${random.pick(["0", "1", "n", "k", "5"])}] ?? "none")`,
      `${of}.trim()`,
      `${of}.trimStart()`,
      `${of}.trimEnd()`,
      `(${of}.split(",")[${random.pick(["0", "1", "n & 1"])}] ?? "none")`,
      `(${of}.split("")[${random.pick(["0", "1", "k"])}] ?? "none")`,
      `(${of}.match(/[a-z]+/)?.[0] ?? "none")`,
      `${of}.replace("a", "")`,
      `${of}.slice(1).slice(${number()})`,
      `${of}.substring(1).trim()`,
      `${of}.slice(0, -1).charAt(0)`,
      `${of}.padEnd(3, "-").slice(1)`,
      `${of}.concat("!").slice(${number()})`,
    ]);
  const inLoop = () =>
    random.pick([
      ``,
      ``,
      `count++;`,
      `if (k === 1) s = ${piece("s")};`,
      `s = ${piece("s")};`,
      `s = ${piece(source())};`,
      `[s, r] = [r, s];`,
      `if (s.length > 1) s = s.slice(1);`,
      `kept.push(s);`,
      `r = s;`,
      `r = r + s;`,
      `if (s === r) count += 2;`,
      `count += s.length;`,
      `if (k > 2) break;`,
      `if (k & 1) continue;`,
      `try { if (k === 2) throw s; } catch (caught) { r = ${isTyped ? "caught as string" : "caught"}; }`,
      `s = kept.length ? kept[kept.length - 1] : s;`,
      `holder.s = s; s = holder.s;`,
      `s = pass(s);`,
      `if (!s) s = ${piece(source())};`,
    ]);
  const loop = (body: string) =>
    random.pick([
      `let k = 0;\n  while (n--) { k++; ${body} }`,
      `let k = 0;\n  while (n--);\n  ${body.replace(/break;|continue;/g, "count++;")}`,
      `let k = 0;\n  for (; k < n; k++) { ${body} }`,
      `let k = 0;\n  do { k++; ${body} } while (k < n);`,
      `let k = 0;\n  for (const each of words) { k++; ${body} }`,
      `let k = 0;\n  for (const key in holder) { k++; ${body} }`,
      `let k = 0;\n  outer: for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { k = i + j; ${body.replace(/break;/g, "break outer;").replace(/continue;/g, "continue outer;")} }`,
      `let k = 0;\n  for (const each of s) { k++; ${body} }`,
      `let k = n;\n  for (;;) { if (k-- <= 0) break; ${body} }`,
    ]);
  const use = (of: string) =>
    random.pick([
      `${of}`,
      `${of}[0]`,
      `${of}[${random.pick(["1", "5"])}]`,
      `${of}.length`,
      `${of}.slice(0)`,
      `${of}.at(0)`,
      `${of}.charAt(0)`,
      `${of}.substring(0, 1)`,
      `${of}.charCodeAt(0)`,
      `${of}.codePointAt(0)`,
      `${of} === "b"`,
      `${of} < "b"`,
      `${of} + "!"`,
      `"<" + ${of} + ">"`,
      "`${" + of + "}`",
      `typeof ${of}`,
      `[...${of}].length`,
      `JSON.stringify(${of})`,
      `${of}.indexOf("b")`,
      `${of}.includes("b")`,
      `${of}.startsWith("b")`,
      `${of}.toUpperCase()`,
      `${of}.split("").reverse().join("")`,
      `(${of} in lookup)`,
      `lookup[${of}${isTyped ? " as keyof typeof lookup" : ""}]`,
      `${of}.localeCompare("b")`,
      `Number(${of})`,
      `${of}.repeat(2)`,
      `!${of}`,
      `(${of} || "empty")`,
      `new Set([${of}, "b"]).size`,
      `${of}.trim().length`,
      `pass(${of}).length`,
      `${of}.concat(${of}).slice(1)`,
    ]);
  const lines: string[] = [
    `const words${t("string[]")} = ["one", "two,three", " four ", "b"];`,
    `const lookup = { b: 1, a: 2, ab: 3, "": 4 };`,
    `const text${t("string")} = words.join("|");`,
    `function pass(value${t("string")})${t("string")} { return value; }`,
    `const tell = (name${t("string")}, make${t("() => unknown")}) => { try { console.log(name, JSON.stringify(make()) ?? "undefined"); } catch (error) { console.log(name, "threw", ${isTyped ? "(error as Error)" : "error"}.name); } };`,
  ];
  const count = random.between(1, 4);
  for (let f = 0; f < count; f++) {
    const body = Array.from({ length: random.between(0, 3) }, inLoop).join(" ");
    const isSimple = random.chance(0.3);
    lines.push(`function make${f}(n${t("number")}, base${t("string")} = "abcb") {
  const k0 = 0;
  let s${t("string")} = ${piece(source()).replace(/\bk\b/g, "k0")};
  let r${t("string")} = ${random.chance(0.5) ? `""` : piece(source()).replace(/\bk\b/g, "k0")};
  let count = 0;
  const kept${t("string[]")} = [];
  const holder = { s: "held", other: 1 };
  ${loop(isSimple ? "" : body)}
  return ${random.pick([`s`, `s`, `s`, use("s"), `[s, r, count]`, `{ s, r }`, `s + r`, `kept.length ? kept[0] : s`, `count ? s : r`, `[${use("s")}, ${use("r")}, kept.join("/")]`])};
}`);
    const given = () =>
      `make${f}(${random.pick(["0", "1", "1", "2", "3", "7"])}${random.chance(0.4) ? `, ${random.pick([`"ab"`, `"b"`, `""`, `text`, `"xyz,b"`, `words[1]`])}` : ""})`;
    for (let call = random.between(1, 4); call > 0; call--) {
      const got = isTyped ? `(${given()} as any)` : given();
      lines.push(
        random.chance(0.25) ? `${given()};` : `tell("make${f}", () => ${random.chance(0.4) ? got : use(got)});`,
      );
    }
    if (random.chance(0.3))
      lines.push(
        `{ let sum = 0; for (let turn = 0; turn < 300; turn++) sum += String(${given().replace(/\((\d)/, "(turn & $1")}).length; console.log("often", sum); }`,
      );
  }
  return lines.join("\n") + "\n";
}
