// A table, no seeds: a loop goes over a typed array and adds something of every element to a variable, from a start that may be whole, have a fraction, lie too far from zero for every whole number to be told apart, or be no number.
//
//   what holds the elements x where it is made x what a turn does x how the loop counts x what the elements are and how many
//
// Every case is a function of the file, called by the file's own code with every start at every length.
type Named = { name: string; text: string };

const typed = (text: string, view: string) => text.replaceAll("$V", `: ${view}`).replaceAll("$N", ": number").replaceAll("$S", ": string").replaceAll("$!", "!"); // prettier-ignore
const untyped = (text: string) => text.replace(/\$[VNS!]/g, "");

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

/** `E` is the element, `F` the other's at the same place, `k` counts, `c` is a parameter that holds 3. */
const turns: readonly (Named & { declares?: string })[] = [
  { name: "added", text: "sum += E;" },
  { name: "taken away", text: "sum -= E;" },
  { name: "added, written out", text: "sum = sum + E;" },
  { name: "added from the left", text: "sum = E + sum;" },
  { name: "added and cut to an int32", text: "sum = (sum + E) | 0;" },
  { name: "taken away and cut to an int32", text: "sum = (sum - E) | 0;" },
  { name: "added and cut to a uint32", text: "sum = (sum + E) >>> 0;" },
  { name: "tripled less 100, added", text: "sum += E * 3 - 100;" },
  { name: "its low byte added", text: "sum += E & 255;" },
  { name: "both added", text: "sum += E + F;" },
  { name: "the difference of both added", text: "sum += E - F;" },
  { name: "its negative added", text: "sum += -E;" },
  { name: "its square added", text: "sum += E * E;" },
  { name: "the product of both added", text: "sum += E * F;" },
  { name: "65537 times it added", text: "sum += E * 65537;" },
  { name: "4294967296 times it added", text: "sum += E * 4294967296;" },
  { name: "shifted left by 8, added", text: "sum += E << 8;" },
  { name: "as a uint32 added", text: "sum += E >>> 0;" },
  { name: "its distance from zero added", text: "sum += Math.abs(E);" },
  { name: "a parameter more, added", text: "sum += E + c;" },
  { name: "half of it added", text: "sum += E / 2;" },
  { name: "the index more, added", text: "sum += E + k;" },
  { name: "the index times it added", text: "sum += E * k;" },
  { name: "added where it is over 100", text: "if (E > 100) sum += E;" },
  { name: "it or nothing added", text: "sum += E > 100 ? E : 0;" },
  { name: "zeros counted", text: "if (E === 0) sum++;" },
  { name: "two sums of one", text: "sum += E; other -= E;" },
  { name: "two sums of two", text: "sum += E; other += F;" },
  { name: "a sum and a sum cut to an int32", text: "sum += E; other = (other + E) | 0;" },
  { name: "one sum added to twice", text: "sum += E; sum += F;" },
  { name: "the sum stored in every turn", text: "sum += E; w[k] = sum;" },
  { name: "the sum read in every turn", text: "sum += E; if (sum > 1000) other++;" },
  { name: "the sum added to another sum", text: "sum += E; other += sum;" },
  { name: "another function changes the sum in between", text: "sum += E; if (k === 5) bump();", declares: "const bump = () => { sum += 0.5; };" }, // prettier-ignore
  { name: "another function reads the sum in between", text: "sum += E; if (k === 5) other = look();", declares: "const look = () => sum;" }, // prettier-ignore
  { name: "exclusive or", text: "sum ^= E;" },
  { name: "or", text: "sum |= E;" },
  { name: "and", text: "sum &= E;" },
  { name: "the greatest", text: "sum = Math.max(sum, E);" },
  { name: "the least", text: "sum = Math.min(sum, E);" },
];

/** `K` is the turn. */
const counted: readonly (Named & { isOverValues?: true })[] = [
  { name: "up to the length", text: "for (let k = 0; k < v.length; k++) { K }" },
  { name: "down from the length", text: "for (let k = v.length - 1; k >= 0; k--) { K }" },
  { name: "over its values", text: "for (const x of v) { K }", isOverValues: true },
  { name: "up to a length read in front", text: "const length = v.length; for (let k = 0; k < length; k++) { K }" },
  { name: "every second", text: "for (let k = 0; k < v.length; k += 2) { K }" },
  { name: "behind a loop that adds up the other's", text: "for (let k = 0; k < w.length; k++) { sum += w[k]$!; } for (let k = 0; k < v.length; k++) { K }" }, // prettier-ignore
];

const fillings = ["zeros", "the greatest and its negative in turns", "the greatest", "the least", "of all sizes"];
const sizes: readonly { name: string; filling: number; lengths: string; starts: string }[] = [
  ...fillings.map((name, filling) => ({ name: `${name}, few`, filling, lengths: "short", starts: "starts" })),
  ...[2, 3, 4].map(filling => ({ name: `${fillings[filling]}, many`, filling, lengths: "long", starts: "someStarts" })),
  ...[2, 3, 4].map(filling => ({ name: `${fillings[filling]}, very many`, filling, lengths: "veryLong", starts: "fewStarts" })), // prettier-ignore
];

const crossed = held.flatMap(holds =>
  places.flatMap(place =>
    turns.flatMap(turn => counted.flatMap(counts => sizes.map(size => ({ holds, place, turn, counts, size })))),
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
    const { holds, place, turn, counts, size } = crossed[((first + at) * stride) % crossed.length];
    const made = (makes: string, filling: number, seed: number) => `given${holds.view === "Buffer" ? "Buffer" : ""}(${makes}, ${filling}, ${holds.most}, ${holds.least}, ${seed})`; // prettier-ignore
    const filled = turn.text.replaceAll("E", counts.isOverValues ? "x" : "v[k]$!").replaceAll("F", "w[k]$!");
    const isCounted = counts.isOverValues && /\bk\b/.test(filled);
    const loop = `${isCounted ? "let k = -1; " : ""}${counts.text.replaceAll("K", `${isCounted ? "k++; " : ""}${filled}`)}`;
    // Where nothing asks for the other's elements it has none.
    const makes = `const v$V = ${made(holds.makes, size.filling, 3)}; const w$V = ${made(loop.includes("w[") ? holds.makes : holds.makes.replace("(n)", "(0)"), 4, 5)};`;
    const isHandedOver = place === "handed over";
    const label = `${holds.view}, ${place} | ${turn.name} | ${counts.name} | ${size.name}`;
    const text = `function f${at}(${isHandedOver ? "v$V, w$V" : "n$N"}, start$N, c$N)$S {
  ${[isHandedOver ? "" : makes, "let sum = start; let other = start;", turn.declares ?? ""].filter(Boolean).join("\n  ")}
  ${loop}
  return show(sum) + "," + show(other);
}
for (const n of ${size.lengths}) {
  ${isHandedOver ? makes : ""}
  console.log(${JSON.stringify(label)} + " | " + n + ": " + ${size.starts}.map(start => f${at}(${isHandedOver ? "v, w" : "n"}, start, 3)).join(" "));
}`.replace(/\n  \n/g, "\n");
    return isTyped ? typed(text, holds.view) : untyped(text);
  });
  const of = (type: string) => (isTyped ? `: ${type}` : "");
  // A Buffer is filled by a function of its own.
  const helper = (
    name: string,
  ) => `function ${name}${isTyped ? "<T extends { [at: number]: number; length: number; fill(value: number): unknown }>" : ""}(view${of("T")}, filling${of("number")}, most${of("number")}, least${of("number")}, seed${of("number")})${of("T")} {
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
const veryLong = [2097151, 2097153, 4500000];
const starts = [0, -0, 1, -7, 0.5, 1e-300, 2 ** 31 - 1, 2 ** 31, 2 ** 32, 2 ** 51 - 1, 2 ** 51, -(2 ** 51), 2 ** 52 + 1, 2 ** 53 - 2, 2 ** 53 - 1, 2 ** 53, -(2 ** 53), 2 ** 53 + 2, 1e300, NaN, Infinity, -Infinity];
const someStarts = [0, -0, 0.5, 2 ** 52 + 1, 2 ** 53 - 2, NaN];
const fewStarts = [0, 0.5, 2 ** 53 - 2];
function show(value${of("number")})${of("string")} { return Object.is(value, -0) ? "-0" : String(value); }
function touch(value${of("number")}) { return value; }
${helper("given")}${helper("givenBuffer")}${functions.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
