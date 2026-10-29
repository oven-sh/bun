// A table, no seeds: a loop goes over a typed array, and a test in every turn chooses between two values: the least or the greatest so far is kept, or one of two values is stored.
//
//   what holds the elements x where it is made x what a turn does x what the kept value begins as x how the loop counts x what the elements are and how many
//
// Every case is a function of the file, called by the file's own code with every start at every length. Some turns do more on one of the two ways: they store, count, call, throw or leave.
type Named = { name: string; text: string };

const typed = (text: string, view: string) => text.replaceAll("$V", `: ${view}`).replaceAll("$N", ": number").replaceAll("$S", ": string").replaceAll("$L", ": number[]").replaceAll("$!", "!"); // prettier-ignore
const untyped = (text: string) => text.replace(/\$[VNSL!]/g, "");

const held: readonly { view: string; makes: string; most: number; least: number }[] = [
  { view: "Int8Array", makes: "new Int8Array(n)", most: 127, least: -128 },
  { view: "Uint8Array", makes: "new Uint8Array(n)", most: 255, least: 0 },
  { view: "Uint8ClampedArray", makes: "new Uint8ClampedArray(n)", most: 255, least: 0 },
  { view: "Int16Array", makes: "new Int16Array(n)", most: 32767, least: -32768 },
  { view: "Uint16Array", makes: "new Uint16Array(n)", most: 65535, least: 0 },
  { view: "Int32Array", makes: "new Int32Array(n)", most: 2147483647, least: -2147483648 },
  { view: "Uint32Array", makes: "new Uint32Array(n)", most: 4294967295, least: 0 },
  { view: "Buffer", makes: "Buffer.alloc(n)", most: 255, least: 0 },
  { view: "Float32Array", makes: "new Float32Array(n)", most: 3.5, least: -3.5 },
  { view: "Float64Array", makes: "new Float64Array(n)", most: 0.1, least: -0.1 },
];

const places = ["handed over", "made in front of the loop"] as const;

const limits = [-129, -128, 127, 128, 255, 256, 32767, 32768, 65535, 65536, 2147483647];

/** `E` is the element, `F` the other's at the same place, `k` counts, `g` and `other` begin at the start, `c` is a parameter that holds 3. */
const turns: readonly (Named & { declares?: string })[] = [
  ...[">", ">=", "<", "<="].flatMap(test => [
    { name: `kept if it ${test} the kept`, text: `if (E ${test} g) g = E;` },
    { name: `kept if the kept ${test} it`, text: `if (g ${test} E) g = E;` },
    { name: `chosen by it ${test} the kept`, text: `g = E ${test} g ? E : g;` },
    { name: `chosen by the kept ${test} it`, text: `g = g ${test} E ? g : E;` },
  ]),
  { name: "Math.max(the kept, it)", text: "g = Math.max(g, E);" },
  { name: "Math.max(it, the kept)", text: "g = Math.max(E, g);" },
  { name: "Math.min(the kept, it)", text: "g = Math.min(g, E);" },
  { name: "Math.min(it, the kept)", text: "g = Math.min(E, g);" },
  { name: "the greatest of it tripled less 100", text: "const x = E * 3 - 100; if (x > g) g = x;" },
  { name: "the greatest low byte", text: "const x = E & 255; if (x > g) g = x;" },
  { name: "the greatest sum of both", text: "const x = E + F; if (x > g) g = x;" },
  { name: "the greatest and the least", text: "if (E > g) g = E; if (E < other) other = E;" },
  { name: "the greatest of each", text: "if (E > g) g = E; if (F > other) other = F;" },
  { name: "at most 100, stored", text: "w[k] = E > 100 ? 100 : E;" },
  { name: "at least 0, stored", text: "w[k] = E < 0 ? 0 : E;" },
  { name: "at least 0 by an if, stored", text: "let x = E; if (x < 0) x = 0; w[k] = x;" },
  {
    name: "between 0 and 100 by two ifs, stored",
    text: "let x = E; if (x < 0) x = 0; if (x > 100) x = 100; w[k] = x;",
  },
  { name: "between -100 and 100 by an if and an else, stored", text: "let x = E; if (x > 100) x = 100; else if (x < -100) x = -100; w[k] = x;" }, // prettier-ignore
  { name: "the greater of both, stored in the other", text: "w[k] = E > F ? E : F;" },
  { name: "the greater of both, stored in itself", text: "v[k] = E > F ? E : F;" },
  { name: "the lesser of both, stored in the other", text: "w[k] = E > F ? F : E;" },
  { name: "1 for 0, stored", text: "w[k] = E === 0 ? 1 : E;" },
  { name: "0 where both are the same, stored", text: "w[k] = E !== F ? E : 0;" },
  { name: "at least a parameter, stored", text: "w[k] = E > c ? E : c;" },
  { name: "100 less or 100 more, stored", text: "w[k] = E > 100 ? E - 100 : E + 100;" },
  { name: "the negative of what is even, stored", text: "w[k] = (E & 1) === 1 ? E : -E;" },
  { name: "1 or 0, stored", text: "w[k] = E > 100 ? 1 : 0;" },
  { name: "the test as a number, stored", text: "w[k] = Number(E > 100);" },
  { name: "1 or 0, added up", text: "g += E > 100 ? 1 : 0;" },
  ...limits.map(limit => ({ name: `at most ${limit}, stored`, text: `w[k] = E > ${limit} ? ${limit} : E;` })),
  { name: "the first place of the greatest", text: "if (E > g) { g = E; other = k; }" },
  { name: "the last place of the greatest", text: "if (E >= g) { g = E; other = k; }" },
  { name: "how often a greater one came", text: "if (E > g) { g = E; other++; }" },
  { name: "a mark is stored where a greater one came", text: "if (E > g) { g = E; w[k] = 1; }" },
  { name: "a function is called where a greater one came", text: "if (E > g) { g = E; noted.push(k); }", declares: "const noted$L = [];" }, // prettier-ignore
  { name: "it throws over 120", text: "if (E > 120) throw new RangeError(String(k)); if (E > g) g = E;" },
  { name: "what is not greater is kept elsewhere", text: "if (E > g) g = E; else other = E;" },
  { name: "it leaves over 100", text: "if (E > g) g = E; if (g > 100) break;" },
  { name: "what is a parameter is passed by", text: "if (E === c) continue; if (E > g) g = E;" },
];

/** `K` is the turn. */
const counted: readonly (Named & { isOverValues?: true })[] = [
  { name: "up to the length", text: "for (let k = 0; k < v.length; k++) { K }" },
  { name: "down from the length", text: "for (let k = v.length - 1; k >= 0; k--) { K }" },
  { name: "over its values", text: "for (const x0 of v) { K }", isOverValues: true },
  { name: "up to a length read in front", text: "const length = v.length; for (let k = 0; k < length; k++) { K }" },
  { name: "every second", text: "for (let k = 0; k < v.length; k += 2) { K }" },
];

const fillings = ["zeros", "the greatest and its negative in turns", "the greatest", "the least", "of all sizes"];
const sizes: readonly { name: string; filling: number; lengths: string; starts: string }[] = [
  ...fillings.map((name, filling) => ({ name: `${name}, few`, filling, lengths: "short", starts: "starts" })),
  { name: "of all sizes, many", filling: 4, lengths: "long", starts: "someStarts" },
];

/** What `g` and `other` begin as. A turn that keeps nothing has the first alone. */
const begins: readonly Named[] = [
  { name: "the start as it comes", text: "let g = start; let other = start;" },
  { name: "the start cut to an int32", text: "let g = start | 0; let other = start | 0;" },
  { name: "the first element", text: "let g = v.length > 0 ? v[0]$! : 0; let other = g;" },
];

const crossed = held.flatMap(holds =>
  places.flatMap(place =>
    turns.flatMap(turn =>
      (/\bg\b/.test(turn.text) ? begins : begins.slice(0, 1)).flatMap(begin =>
        counted.flatMap(counts => sizes.map(size => ({ holds, place, turn, begin, counts, size }))),
      ),
    ),
  ),
);

export const inOne = 20;
const laidOut = [
  { isTyped: true, flags: [] },
  { isTyped: true, flags: ["--aot-heat=everything-is-hot"] },
  { isTyped: true, flags: ["--aot-erase-types"] },
  { isTyped: false, flags: [] },
  { isTyped: false, flags: ["--aot-heat=everything-is-hot"] },
];
const inOneBuild = Math.ceil(crossed.length / inOne);
export const programs = laidOut.length * inOneBuild;
export const cases = crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / inOneBuild)].flags;

export function programOf(index: number): { file: string; text: string } {
  const { isTyped } = laidOut[Math.floor(index / inOneBuild)];
  const first = (index % inOneBuild) * inOne;
  // Neighbors in the table differ in the elements alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const functions = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { holds, place, turn, begin, counts, size } = crossed[((first + at) * stride) % crossed.length];
    const made = (filling: number, seed: number) => `given${holds.view === "Buffer" ? "Buffer" : ""}(${holds.makes}, ${filling}, ${holds.most}, ${holds.least}, ${seed})`; // prettier-ignore
    const makes = `const v$V = ${made(size.filling, 3)}; const w$V = ${made(4, 5)};`;
    const filled = turn.text.replace(/\bE\b/g, counts.isOverValues ? "x0" : "v[k]$!").replace(/\bF\b/g, "w[k]$!");
    const isCounted = counts.isOverValues && /\bk\b/.test(filled);
    const loop = `${isCounted ? "let k = -1; " : ""}${counts.text.replaceAll("K", `${isCounted ? "k++; " : ""}${filled}`)}`;
    const isHandedOver = place === "handed over";
    const label = `${holds.view}, ${place} | ${turn.name} | ${begin.name} | ${counts.name} | ${size.name}`;
    const text = `function f${at}(${isHandedOver ? "v$V, w$V" : "n$N"}, start$N, c$N)$S {
  ${[isHandedOver ? "" : makes, begin.text, turn.declares ?? ""].filter(Boolean).join("\n  ")}
  ${loop}
  return show(g) + "," + show(other) + "," + digest(v) + "," + digest(w)${turn.declares ? ' + "," + noted.length' : ""};
}
for (const n of ${size.lengths}) {
  ${isHandedOver ? makes : ""}
  console.log(${JSON.stringify(label)} + " | " + n + ": " + ${size.starts}.map(start => attempt(() => f${at}(${isHandedOver ? "v, w" : "n"}, start, 3))).join(" "));
}`.replace(/\n  \n/g, "\n");
    return isTyped ? typed(text, holds.view) : untyped(text);
  });
  const of = (type: string) => (isTyped ? `: ${type}` : "");
  const view = "{ [at: number]: number; length: number; fill(value: number): unknown }";
  // A Buffer is filled by a function of its own.
  const helper = (
    name: string,
  ) => `function ${name}${isTyped ? `<T extends ${view}>` : ""}(view${of("T")}, filling${of("number")}, most${of("number")}, least${of("number")}, seed${of("number")})${of("T")} {
  if (filling === 0 || filling === 2 || filling === 3) { view.fill(filling === 0 ? 0 : filling === 2 ? most : least); return view; }
  let at = 0;
  while (at < view.length) { view[at] = filling === 1 ? (at % 2 === 0 ? most : -most) : touch(Math.imul(at + 1, seed * 40503 + 1) >> [0, 16, 24, 23, 15][at % 5]${isTyped ? "!" : ""}); at += 1 + touch(0); }
  return view;
}
`;
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: `const short = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 31, 32, 33, 63, 64, 65];
const long = [131071, 131072, 131073];
const starts = [-Infinity, Infinity, NaN, 0.5, -0, 0, -1, 1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296];
const someStarts = [-Infinity, Infinity, NaN, 0.5, -0, 0];
function show(value${of("number")})${of("string")} { return Object.is(value, -0) ? "-0" : String(value); }
function touch(value${of("number")}) { return value; }
function attempt(run${of("() => string")})${of("string")} { try { return run(); } catch (error) { return "threw " + (error${isTyped ? " as Error" : ""}).message; } }
function digest(view${of("{ [at: number]: number; length: number }")})${of("number")} {
  let all = 0, at = 0;
  while (at < view.length) { all = (Math.imul(all, 31) + touch(view[at]${isTyped ? "!" : ""} * 2)) | 0; at += 1 + touch(0); }
  return all;
}
${helper("given")}${helper("givenBuffer")}${functions.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
