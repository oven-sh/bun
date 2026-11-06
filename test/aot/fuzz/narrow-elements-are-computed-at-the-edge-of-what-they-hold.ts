// A table, no seeds: a short loop computes every element of a typed array of whole numbers anew, with limits and intermediate values inside, at and beyond what an element holds.
//
//   what holds the elements x where it is made x what is computed x how the loop counts x what runs around the loop, each at every length from 0 to 17 and from 31 to 33
//
// The elements run over the whole range of 8, 16 and 32 bits. Every case is a function of the file, called by the file's own code.
type Named = { name: string; text: string };

const typed = (text: string, view: string) =>
  text.replaceAll("$V", `: ${view}`).replaceAll("$N", ": number").replaceAll("$S", ": string").replaceAll("$O", ": object[]").replaceAll("$!", "!"); // prettier-ignore
const untyped = (text: string) => text.replace(/\$[VNSO!]/g, "");

const views = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
];
/** Where `isOneBuffer`, the other begins one element further in the same buffer. */
const held: readonly { name: string; view: string; isOneBuffer?: true }[] = [
  ...views.map(view => ({ name: view, view })),
  ...views.map(view => ({ name: `two views of one buffer, ${view}`, view, isOneBuffer: true as const })),
];

const places = ["handed over", "made in front of the loops"] as const;

const limits = [-129, -128, 127, 128, 255, 256, 32767, 32768, 65535, 65536];
const ranges = [[-128, 127], [-129, 128], [0, 255], [0, 256], [-1, 254], [-32768, 32767], [-32769, 32768], [0, 65535], [0, 65536]]; // prettier-ignore

/** `v` and `w` hold the elements, `k` counts, `c` is a parameter that holds 3. */
const done: readonly Named[] = [
  { name: "a parameter is added", text: "v[k] = v[k]$! + c;" },
  { name: "one of two numbers is added", text: "v[k] = v[k]$! + (c > 2 ? 9 : -9);" },
  { name: "a number is added", text: "v[k] = v[k]$! + 100;" },
  { name: "a number is taken away", text: "v[k] = v[k]$! - 100;" },
  { name: "it is tripled and a number is taken away", text: "v[k] = v[k]$! * 3 - 100;" },
  { name: "the other's is added", text: "v[k] = v[k]$! + w[k]$!;" },
  { name: "the other's is taken away", text: "v[k] = v[k]$! - w[k]$!;" },
  { name: "the mean of both", text: "v[k] = (v[k]$! + w[k]$!) >> 1;" },
  ...limits.flatMap(limit => [
    { name: `the lesser of it and ${limit}`, text: `v[k] = Math.min(v[k]$!, ${limit});` },
    { name: `the greater of it and ${limit}`, text: `v[k] = Math.max(v[k]$!, ${limit});` },
  ]),
  ...ranges.flatMap(([low, high]) => [
    {
      name: `held between ${low} and ${high}, the lower limit first`,
      text: `v[k] = Math.min(Math.max(v[k]$!, ${low}), ${high});`,
    },
    {
      name: `held between ${low} and ${high}, the upper limit first`,
      text: `v[k] = Math.max(Math.min(v[k]$!, ${high}), ${low});`,
    },
    {
      name: `doubled and held between ${low} and ${high}`,
      text: `v[k] = Math.min(Math.max(v[k]$! * 2, ${low}), ${high});`,
    },
  ]),
  ...["* 128", "* 129", "* 257", "+ 32512", "+ 32513", "<< 7", "<< 8", "* 255", "* 65537", "+ 2147483647"].map(does => ({ name: `it ${does}`, text: `v[k] = v[k]$! ${does};` })), // prettier-ignore
  { name: "it * 129 + 32513", text: "v[k] = v[k]$! * 129 + 32513;" },
  { name: "(it << 7) + 32512", text: "v[k] = (v[k]$! << 7) + 32512;" },
  { name: "(it * 257 - 100) * 3", text: "v[k] = (v[k]$! * 257 - 100) * 3;" },
  { name: "(it + 32513) * 2 - the other's", text: "v[k] = (v[k]$! + 32513) * 2 - w[k]$!;" },
  { name: "(it * the other's) >> 8", text: "v[k] = (v[k]$! * w[k]$!) >> 8;" },
  { name: "the greater of both", text: "v[k] = Math.max(v[k]$!, w[k]$!);" },
  { name: "the lesser of both", text: "v[k] = Math.min(v[k]$!, w[k]$!);" },
  { name: "the greater of both by a test", text: "v[k] = v[k]$! > w[k]$! ? v[k]$! : w[k]$!;" },
  { name: "the distance of both", text: "v[k] = Math.abs(v[k]$! - w[k]$!);" },
];

/** `K` is what is computed. */
const counted: readonly Named[] = [
  { name: "up to the length", text: "for (let k = 0; k < v.length; k++) { K }" },
  { name: "down from the length", text: "for (let k = v.length - 1; k >= 0; k--) { K }" },
  { name: "from both ends", text: "for (let low = 0, high = v.length - 1; low < high; low++, high--) { { const k = low; K } { const k = high; K } }" }, // prettier-ignore
];

/** `L` is the loop in a block of its own. With `hasRounds`, `text` is one round of a loop that counts `round`. */
const around: readonly (Named & { declares?: string; hasRounds?: true })[] = [
  { name: "nothing", text: "L" },
  { name: "rounds and nothing else", text: "L", hasRounds: true },
  {
    name: "an object made in front",
    declares: "const noted$O = [];",
    text: "noted.push({ round }); L",
    hasRounds: true,
  },
  { name: "a text joined behind", declares: 'let text = "";', text: "L text = String(v.length) + text.length;", hasRounds: true }, // prettier-ignore
];

const crossed = held.flatMap(holds =>
  places.flatMap(place =>
    done.flatMap(does => counted.flatMap(counts => around.map(runs => ({ holds, place, does, counts, runs })))),
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
  // Neighbors in the table differ in what runs around the loop alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const functions = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { holds, place, does, counts, runs } = crossed[((first + at) * stride) % crossed.length];
    const written = (text: string) => (isTyped ? typed(text, holds.view) : untyped(text));
    const made = (seed: number) => `given(new ${holds.view}(n${holds.isOneBuffer ? " + 1" : ""}), ${seed})`;
    const other = holds.isOneBuffer ? "v.subarray(1)" : made(5);
    const makes = `const v$V = ${made(3)}; const w$V = ${other};`;
    const inside = runs.text.replaceAll("L", `{ ${counts.text.replaceAll("K", does.text)} }`);
    const body = runs.hasRounds ? `for (let round = 0; round < rounds; round++) {\n    ${inside}\n  }` : inside;
    const parameters = place === "handed over" ? "v$V, w$V, rounds$N, c$N" : "n$N, rounds$N, c$N";
    const call =
      place !== "handed over"
        ? `f${at}(n, 3, 3)`
        : holds.isOneBuffer
          ? `((v$V) => f${at}(v, v.subarray(1), 3, 3))(${made(3)})`
          : `f${at}(${made(3)}, ${made(5)}, 3, 3)`;
    const label = `${holds.name}, ${place} | ${does.name} | ${counts.name} | ${runs.name}`;
    return written(`function f${at}(${parameters})$S {
  ${[place === "made in front of the loops" ? makes : "", runs.declares ?? ""].filter(Boolean).join("\n  ")}
  ${body}
  return said(v) + " " + said(w);
}
for (const n of lengths) console.log(${JSON.stringify(label)} + " | " + n + ": " + ${call});`).replace(/\n  \n/g, "\n");
  });
  const of = (type: string) => (isTyped ? `: ${type}` : "");
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: `const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 31, 32, 33];
function touch(value${of("number")}) { return value; }
function given${isTyped ? "<T extends { [at: number]: number; length: number }>" : ""}(view${of("T")}, seed${of("number")})${of("T")} {
  let at = 0;
  while (at < view.length) { view[at] = touch(Math.imul(at + 1, seed * 40503 + 1) >> [0, 16, 24, 23, 15][at % 5]${isTyped ? "!" : ""}); at += 1 + touch(0); }
  return view;
}
function said(view${of("ArrayLike<number>")})${of("string")} {
  const text = Array.prototype.join.call(view, ",");
  if (view.length < 10) return "[" + text + "]";
  let hash = 0;
  for (const unit of text) hash = (Math.imul(hash, 31) + unit.charCodeAt(0)) | 0;
  return "#" + (hash >>> 0).toString(16);
}
${functions.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
