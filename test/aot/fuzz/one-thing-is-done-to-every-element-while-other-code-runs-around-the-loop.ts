// A table, no seeds: a short loop does one thing to every element of a list of numbers or of a typed array, and around that loop other code runs: an allocation, a call, a collection, an await.
// What the elements hold afterwards does not depend on what ran in between.
//
//   what holds the elements x where it is made x what is done to an element x how the loop counts x what runs around the loop, each at several lengths
//
// Every case is a function of the file, called by the file's own code.
type Named = { name: string; text: string };

const typed = (text: string, view: string) =>
  text
    .replaceAll("$V", `: ${view}`)
    .replaceAll("$N", ": number")
    .replaceAll("$S", ": string")
    .replaceAll("$P", ": Promise<string>")
    .replaceAll("$I", ": Generator<number, string, unknown>")
    .replaceAll("$G", "<number>")
    .replaceAll("$!", "!");
const untyped = (text: string) => text.replace(/\$[VNSPIG!]/g, "");

/** `makes` makes it with `n` elements. What `hasHoles` is not given elements in front of the loop. Where `isOneBuffer`, the other begins one element further in the same buffer. */
const held: readonly { name: string; view: string; makes: string; hasHoles?: true; isOneBuffer?: true }[] = [
  ...["Uint8Array", "Int8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array"].map(view => ({ name: view, view, makes: `new ${view}(n)` })), // prettier-ignore
  ...["Uint8Array", "Int16Array", "Int32Array", "Float32Array", "Float64Array"].map(view => ({ name: `two views of one buffer, ${view}`, view, makes: `new ${view}(n + 1)`, isOneBuffer: true as const })), // prettier-ignore
  { name: "new Array(n)", view: "Array<number>", makes: "new Array$G(n)", hasHoles: true },
  { name: "Array(n)", view: "Array<number>", makes: "Array(n)", hasHoles: true },
  { name: "a list filled with whole numbers", view: "number[]", makes: "new Array$G(n).fill(0)" },
  { name: "a list filled with fractions", view: "number[]", makes: "new Array$G(n).fill(0.5)" },
  { name: "a list out of Array.from", view: "number[]", makes: "Array.from({ length: n }, (_, at) => at)" },
];

const places = ["handed over", "made in front of the loops", "made in every round"] as const;

/** `v` and `w` hold the elements, `k` counts, `c` is a parameter. What `readsPastTheEnd` is for typed arrays. */
const done: readonly (Named & { readsPastTheEnd?: true })[] = [
  { name: "a small number is stored", text: "v[k] = 7;" },
  { name: "a fraction is stored", text: "v[k] = 0.25;" },
  { name: "a negative number is stored", text: "v[k] = -300;" },
  { name: "a large number is stored", text: "v[k] = 0x01020304;" },
  { name: "a parameter is stored", text: "v[k] = c;" },
  { name: "the counter is stored", text: "v[k] = k;" },
  { name: "a number is added", text: "v[k] = v[k]$! + 3;" },
  { name: "a number is added and the sum is wrapped", text: "v[k] = (v[k]$! + 0x00010001) | 0;" },
  { name: "it is multiplied by a fraction", text: "v[k] = v[k]$! * 1.0625;" },
  { name: "it is multiplied by a parameter", text: "v[k] = v[k]$! * c;" },
  { name: "its sign is turned", text: "v[k] = -v[k]$!;" },
  { name: "bits are masked", text: "v[k] = v[k]$! & 0x0f0f;" },
  { name: "bits are turned", text: "v[k] = v[k]$! ^ 0x5555;" },
  { name: "it is shifted", text: "v[k] = v[k]$! << 1;" },
  { name: "it is copied from the other", text: "v[k] = w[k]$!;" },
  { name: "the other's is added", text: "v[k] = v[k]$! + w[k]$!;" },
  { name: "the other's is scaled and moved", text: "v[k] = w[k]$! * 0.5 + 0.25;" },
  { name: "two numbers are stored, one in each", text: "v[k] = 7; w[k] = 9;" },
  { name: "the smaller of it and a number is stored", text: "v[k] = Math.min(v[k]$!, 5);" },
  { name: "one of two numbers is stored", text: "v[k] = v[k]$! > 4 ? 1 : 2;" },
  { name: "a number is taken away", text: "v[k] = v[k]$! - 3;" },
  { name: "it is divided by a number", text: "v[k] = v[k]$! / 3;" },
  { name: "its root is taken", text: "v[k] = Math.sqrt(v[k]$!);" },
  { name: "its size is taken", text: "v[k] = Math.abs(v[k]$! - 5);" },
  { name: "bits are set", text: "v[k] = v[k]$! | 0x1010;" },
  { name: "it is copied from its neighbor", text: "v[k] = v[k + 1]$!;", readsPastTheEnd: true },
];

/** `K` is what is done. What `isUpToEight` runs over lists of eight elements or more. What `isWhole` has no place for `K`. */
const counted: readonly (Named & { isUpToEight?: true; isWhole?: true })[] = [
  { name: "up to the length", text: "for (let k = 0; k < v.length; k++) { K }" },
  { name: "up to the length read once", text: "const end = v.length; for (let k = 0; k < end; k++) { K }" },
  { name: "up to eight", text: "for (let k = 0; k < 8; k++) { K }", isUpToEight: true },
  { name: "down from the length", text: "for (let k = v.length - 1; k >= 0; k--) { K }" },
  { name: "in a while loop", text: "let k = 0; while (k < v.length) { K k++; }" },
  { name: "in a do loop", text: "let k = 0; if (v.length > 0) do { K k++; } while (k < v.length);" },
  { name: "from both ends", text: "for (let low = 0, high = v.length - 1; low < high; low++, high--) { { const k = low; K } { const k = high; K } }" }, // prettier-ignore
  { name: "turned round in place", text: "for (let low = 0, high = v.length - 1; low < high; low++, high--) { const kept = v[low]$!; v[low] = v[high]$!; v[high] = kept; }", isWhole: true }, // prettier-ignore
];

/** `L` is the loop in a block of its own. With `rounds`, `text` is one round of a loop that counts `round`. `kind` says what the function is. */
const around: readonly (Named & { declares?: string; hasRounds?: true; kind?: "async" | "generator" })[] = [
  { name: "nothing", text: "L" },
  { name: "a call between two such loops", text: "L touch(v); L" },
  { name: "a callback of a built-in", text: "[0, 1, 2].forEach(() => L);" },
  { name: "rounds and nothing else", text: "L", hasRounds: true },
  {
    name: "an object made in front",
    declares: "const noted$O = [];",
    text: "noted.push({ round }); L",
    hasRounds: true,
  },
  { name: "a text joined in front", declares: 'let text = "";', text: 'text += String(round) + [round, text.length].join("-"); L', hasRounds: true }, // prettier-ignore
  { name: "a text joined behind", declares: 'let text = "";', text: "L text = String(v.length) + text.length;", hasRounds: true }, // prettier-ignore
  { name: "a collection in front", text: "if (round % 3 === 1) collect(); L", hasRounds: true },
  { name: "a call that nobody can follow in front", text: "unknown(() => round); L", hasRounds: true },
  { name: "a throw that is caught", declares: "let caught = 0;", text: 'try { if (round === 1) throw new Error("thrown"); L } catch { caught++; }', hasRounds: true }, // prettier-ignore
  { name: "a sort behind", declares: "const order = [3, 1, 2];", text: "L order.sort((a, b) => a - b + round - round);", hasRounds: true }, // prettier-ignore
  { name: "an await in front", text: "await null; L", hasRounds: true, kind: "async" },
  { name: "a yield in front", text: "yield round; L", hasRounds: true, kind: "generator" },
];

const crossed = held.flatMap(holds =>
  places.flatMap(place =>
    done
      .filter(does => !does.readsPastTheEnd || holds.view.endsWith("Array"))
      .flatMap((does, nth) =>
        counted
          .filter(counts => !counts.isWhole || nth === 0)
          .flatMap(counts =>
            around
              .filter(runs => runs.hasRounds || place !== "made in every round")
              .map(runs => ({ holds, place, does, counts, runs })),
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
  // Neighbors in the table differ in what runs around the loop alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const functions = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { holds, place, does, counts, runs } = crossed[((first + at) * stride) % crossed.length];
    const written = (text: string) => (isTyped ? typed(text.replaceAll("$O", ": object[]"), holds.view) : untyped(text.replaceAll("$O", ""))); // prettier-ignore
    const made = (seed: number) => (holds.hasHoles ? holds.makes : `given(${holds.makes}, ${seed})`);
    const other = holds.isOneBuffer ? "v.subarray(1)" : made(5);
    const makes = `const v$V = ${made(3)}; const w$V = ${other};`;
    const loop = `{ ${counts.text.replaceAll("K", does.text)} }`;
    const inside = runs.text.replaceAll("L", loop);
    const says = 'said(v) + " " + said(w)';
    const body = !runs.hasRounds
      ? `${inside}\n  return ${says};`
      : place === "made in every round"
        ? `let out = "";\n  for (let round = 0; round < rounds; round++) {\n    ${makes}\n    ${inside}\n    out = ${says};\n  }\n  return out;`
        : `for (let round = 0; round < rounds; round++) {\n    ${inside}\n  }\n  return ${says};`;
    const head = runs.kind === "async" ? "async function" : runs.kind === "generator" ? "function*" : "function";
    const returns = runs.kind === "async" ? "$P" : runs.kind === "generator" ? "$I" : "$S";
    const parameters = place === "handed over" ? "v$V, w$V, rounds$N, c$N" : "n$N, rounds$N, c$N";
    const handed = place !== "handed over" ? "n, 4, 3" : holds.isOneBuffer ? "v, v.subarray(1), 4, 3" : `${made(3)}, ${made(5)}, 4, 3`; // prettier-ignore
    const called = runs.kind === "generator" ? `drained(f${at}(${handed}))` : `f${at}(${handed})`;
    const call = `${runs.kind === "async" ? "await " : ""}${place === "handed over" && holds.isOneBuffer ? `((v$V) => ${called})(${made(3)})` : called}`; // prettier-ignore
    const label = `${holds.name}, ${place} | ${counts.isWhole ? "nothing else" : does.name} | ${counts.name} | ${runs.name}`;
    return written(`${head} f${at}(${parameters})${returns} {
  ${[place === "made in front of the loops" ? makes : "", runs.declares ?? ""].filter(Boolean).join("\n  ")}
  ${body}
}
for (const n of ${counts.isUpToEight ? "[8, 9, 17, 33]" : "[0, 1, 3, 8, 9, 17, 33]"}) console.log(${JSON.stringify(label)} + " | " + n + ": " + ${call});`).replace(
      /\n  \n/g,
      "\n",
    );
  });
  const of = (type: string) => (isTyped ? `: ${type}` : "");
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text: `const unknown = new Function("f", "return f()");
function touch(value${of("unknown")}) { return value; }
function collect() { ${isTyped ? "(globalThis as unknown as { Bun: { gc(isFull: boolean): void } }).Bun" : "Bun"}.gc(true); }
function given${isTyped ? "<T extends { [at: number]: number; length: number }>" : ""}(view${of("T")}, seed${of("number")})${of("T")} {
  let at = 0;
  while (at < view.length) { view[at] = touch((at * seed + 3) % 11)${isTyped ? " as number" : ""}; at += 1 + (touch(0)${isTyped ? " as number" : ""}); }
  return view;
}
function said(view${of("ArrayLike<number>")})${of("string")} {
  const text = Array.prototype.join.call(view, ",");
  if (view.length < 10) return "[" + text + "]";
  let hash = 0;
  for (const unit of text) hash = (Math.imul(hash, 31) + unit.charCodeAt(0)) | 0;
  return "#" + (hash >>> 0).toString(16);
}
function drained(steps${of("Generator<number, string, unknown>")})${of("string")} {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
${functions.join("\n")}
${isTyped ? "export {};\n" : ""}`,
  };
}
