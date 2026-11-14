// Elements under indexes that are elements: the list, times the list of indexes, times the access, times the value, times what the two share, times an odd index, times the loop, with nothing beside.
//
//   bun write-indirect-element-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<indexes>--<access>--<value>--<shared>--<odd>--<loop>.mjs, .cjs or .ts
//   bun write-indirect-element-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `a` is the list, `at` the list of indexes.
const lists: [name: string, text: string][] = [["integers", "const a = [1, 2, 3, 4, 5, 6, 7, 8];"], ["doubles", "const a = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];"], ["words", "const a = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);"], ["floats", "const a = new Float64Array([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);"], ["bytes", "const a = new Uint8Array([1, 2, 3, 250, 251, 252, 253, 254]);"], ["short-floats", "const a = new Float32Array([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);"], ["unsigned", "const a = new Uint32Array([1, 2, 3, 4294967290, 5, 6, 7, 8]);"], ["holes", "const a = [1, , 3, , 5, 6, 7, 8];"], ["texts", "const a = ['p', 'q', 'r', 's', 't', 'u', 'v', 'w'];"], ["of-both", "const a = [1, 'b', 2.5, null, 5, undefined, 7, 8];"], ["half-words", "const a = new Int16Array([1, 2, 3, 32760, 5, 6, 7, 8]);"], ["outside", "const a = shared;"]]; // prettier-ignore
const indexes: [name: string, text: string][] = [["integers", "const at = [2, 0, 3, 1, ODD];"], ["words", "const at = new Int32Array([2, 0, 3, 1, ODDN]);"], ["bytes", "const at = new Uint8Array([2, 0, 3, 1, ODDN]);"], ["floats", "const at = new Float64Array([2, 0, 3, 1, ODDN]);"], ["unsigned", "const at = new Uint32Array([2, 0, 3, 1, ODDN]);"], ["doubles", "const at = [2, 0, 3, 1, 0.5, ODD];"], ["holes", "const at = [2, , 3, 1, ODD];"], ["half-words", "const at = new Uint16Array([2, 0, 3, 1, ODDN]);"], ["objects", "const at = [{ i: 2 }, { i: 0 }, { i: 3 }, { i: ODD }];"]]; // prettier-ignore
// I is the index, V the value.
const accesses: [name: string, text: string][] = [["read", "out.push(a[I]);"], ["sum", "s += +a[I] || 0;"], ["store", "a[I] = V;"], ["add", "a[I] += V;"], ["subtract", "a[I] -= V;"], ["step", "a[I]++;"], ["copied", "a[i] = a[I];"], ["copied-back", "a[I] = a[i];"], ["swapped", "const t = a[I];\na[I] = a[i];\na[i] = t;"], ["tested", "if (a[I] > 2) s++;"], ["twice", "a[I] += a[at[0]?.i ?? at[0]];"], ["index-stored", "if (typeof at[i] === 'number') at[i] = a[I] & 3;\nout.push(at[i]);"], ["xor", "a[I] ^= V;"], ["greatest", "if (a[I] > s) s = a[I];"], ["counted", "counts[a[I]] = (counts[a[I]] ?? 0) + 1;"], ["both-kept", "const x = a[I];\na[0] = V;\nout.push(x, a[I]);"]]; // prettier-ignore
const values: [name: string, text: string][] = [["one", "1"], ["counter", "i"], ["double", "0.5"], ["sum", "s"], ["element", "a[i]"], ["index", "I"], ["large", "4294967297"], ["not-a-number", "NaN"], ["text", "'x'"]]; // prettier-ignore
const shares: [name: string, text: string][] = [["nothing", ""], ["same-list", "SAME"], ["shorter-later", "if (Array.isArray(a)) a.length = 6;"], ["frozen", "if (Array.isArray(a)) Object.freeze(a);"], ["handed", "see(a, at);"]]; // prettier-ignore
const odd: [name: string, text: string, number_: string][] = [["inside", "4", "4"], ["past", "99", "99"], ["negative", "-1", "-1"], ["not-a-number", "NaN", "NaN"], ["fraction", "1.5", "1.5"], ["text", "'2'", "2"], ["minus-zero", "-0", "-0"], ["large", "4294967295", "4294967295"], ["name", "'length'", "7"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["of-length", "for (let i = 0; i < at.length; i++) {\n  DO\n}"], ["nested", "for (let k = 0; k < 3; k++) {\n  for (let i = 0; i < at.length; i++) {\n    DO\n  }\n}"], ["given", "for (let i = 0; i < n; i++) {\n  DO\n}"], ["down", "for (let i = at.length; i-- > 0; ) {\n  DO\n}"], ["row", "for (let j = 0; j < 2; j++) {\n  let t2 = s;\n  for (let i = 0; i < at.length; i++) {\n    DO\n  }\n  s = t2 + 1;\n}"], ["once", "{\n  const i = at.length - 1;\n  DO\n}"]]; // prettier-ignore
const total =
  lists.length * indexes.length * accesses.length * values.length * shares.length * odd.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const access = pick(accesses);
  const list = pick(lists);
  const index = pick(indexes);
  const strange = pick(odd);
  const loop = pick(loops);
  const value = pick(values);
  const share = pick(shares);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && share[0] !== "frozen";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const place = index[0] === "objects" ? "at[i]?.i" : "at[i]";
  const deed = access[1].replaceAll(/\bV\b/g, value[1]).replaceAll(/\bI\b/g, place);
  const isSame = share[0] === "same-list" && index[0] !== "objects";
  const body = [
    list[1],
    isSame ? "const at = a;" : index[1].replaceAll("ODDN", strange[2]).replaceAll("ODD", strange[1]),
    "let s = 0;",
    ...(/counts/.test(deed) ? ["const counts = {};"] : []),
    ...(share[1] && !isSame && share[0] !== "same-list" ? [share[1]] : []),
    within(loop[1], "DO", deed),
    `return list(a) + '|' + show(s) + '|' + list(at)${/counts/.test(deed) ? " + JSON.stringify(counts)" : ""};`,
  ].join("\n");
  const any = isTyped ? ": number" : "";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "const show = x => (Object.is(x, -0) ? '-0' : String(x).slice(0, 40));",
    "const list = a => a.length + ':' + Array.from({ length: Math.min(a.length, 14) }, (_, k) => show(a[k]?.i ?? a[k])).join();",
    ...(/\bshared\b/.test(body) ? ["const shared = [1, 2, 3, 4, 5, 6, 7, 8];"] : []),
    ...(/see\(/.test(body) ? ["const see = (a, at) => a.length + at.length;"] : []),
    `function run(n${any}) {\n${indent(body, "  ")}\n}`,
    "for (const n of [3, 5]) {",
    "  try {",
    "    console.log(run(n));",
    "  } catch (error) {",
    "    console.log(error.name);",
    "  }",
    "}",
    "console.log(out.map(show).join().slice(0, 600));",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${index[0]}--${access[0]}--${value[0]}--${share[0]}--${strange[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
