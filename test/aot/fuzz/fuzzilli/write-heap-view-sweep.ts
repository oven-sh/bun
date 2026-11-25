// Views in variables of a file over one buffer, as compiled C programs have them: the kind of view, times the buffer, times the index, times the access, times what changes the view, times when, times the loop, times how the variables are declared, with nothing beside.
//
//   bun write-heap-view-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<kind>--<buffer>--<index>--<access>--<change>--<moment>--<loop>--<declared>.mjs, .cjs or .ts
//   bun write-heap-view-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const kinds: [name: string, kind: string, bytes: number][] = [["words", "Int32Array", 4], ["bytes", "Uint8Array", 1], ["doubles", "Float64Array", 8], ["floats", "Float32Array", 4], ["half-words", "Int16Array", 2], ["unsigned-words", "Uint32Array", 4], ["signed-bytes", "Int8Array", 1], ["clamped", "Uint8ClampedArray", 1], ["unsigned-half-words", "Uint16Array", 2], ["big", "BigInt64Array", 8]]; // prettier-ignore
// K is the kind; `buffer` and `view` are assigned, `other` is a second view of the same buffer.
const buffers: [name: string, text: string][] = [
  ["plain", "buffer = new ArrayBuffer(128);\nview = new K(buffer);\nother = new Uint8Array(buffer);"],
  [
    "resizable",
    "buffer = new ArrayBuffer(128, { maxByteLength: 256 });\nview = new K(buffer);\nother = new Uint8Array(buffer);",
  ],
  ["shared", "buffer = new SharedArrayBuffer(128);\nview = new K(buffer);\nother = new Uint8Array(buffer);"],
  ["offset", "buffer = new ArrayBuffer(128);\nview = new K(buffer, 16);\nother = new Uint8Array(buffer, 8);"],
  ["of-length", "buffer = new ArrayBuffer(128);\nview = new K(buffer, 8, 4);\nother = new Uint8Array(buffer, 0, 64);"],
  [
    "fixed-of-resizable",
    "buffer = new ArrayBuffer(128, { maxByteLength: 256 });\nview = new K(buffer, 0, 8);\nother = new Uint8Array(buffer, 0, 64);",
  ],
  ["own", "view = new K(16);\nother = new Uint8Array(16);\nbuffer = view.buffer;"],
];
// The index of the access; `i` counts, p is given.
const indexes: [name: string, text: string][] = [["counter", "i"], ["shifted", "(p + (i << 2)) >> 2"], ["constant", "3"], ["masked", "(p + i) & 7"], ["next", "i + 1"], ["before", "i - 1"], ["past", "i + 60"], ["negative", "-1"], ["last", "view.length - 1"], ["truncated", "(p + i) | 0"], ["unsigned", "(p + i) >>> 0"], ["double", "i / 2"], ["of-other", "other[i] & 7"], ["product", "i * 2"]]; // prettier-ignore
// AT is the index.
const accesses: [name: string, text: string][] = [
  ["read", "out.push(view[AT]);"],
  ["store", "view[AT] = ONE;"],
  ["add", "view[AT] += ONE;"],
  ["step", "view[AT]++;"],
  ["copied", "view[AT] = view[0];"],
  ["two-reads", "out.push(view[AT], view[0]);"],
  ["read-then-store", "const x = view[AT];\nview[1] = x;\nout.push(x);"],
  ["through-other", "other[i] = i + 1;\nout.push(view[AT]);"],
  ["store-then-other", "view[AT] = ONE;\nout.push(other[i]);"],
  ["tested", "if (view[AT]) out.push('yes');\nelse out.push('no');"],
  ["summed", "sum += Number(view[AT]);"],
  ["length", "out.push(view.length, AT in view);"],
  ["swapped", "[view[0], view[AT]] = [view[AT], view[0]];"],
];
const changes: [name: string, text: string][] = [
  ["nothing", ";"],
  ["detached", "buffer.transfer?.();"],
  ["cloned-away", "structuredClone(buffer, { transfer: [buffer] });"],
  ["shrunk", "buffer.resize(16);"],
  ["grown", "buffer.resize(256);"],
  ["replaced", "view = new K(4);"],
  ["replaced-by-longer", "view = new K(64);"],
  ["other-kind", "view = new Uint8Array([7, 8, 9, 10, 11]);"],
  ["list", "view = [ONE, , ONE];"],
  ["null", "view = null;"],
  ["object", "view = { 0: ONE, length: 1 };"],
  ["part", "view = view.subarray(1, 3);"],
  ["same-buffer", "view = new K(buffer, 8);"],
  ["exchanged", "[view, other] = [other, view];"],
  ["prototype", "Object.setPrototypeOf(view, { 99: 1 });"],
  ["field", "view.extra = 1;"],
  ["filled", "view.fill(ONE);"],
  ["frozen", "Object.freeze(view);"],
];
// CHANGE is the change; GO runs the loop.
const moments: [name: string, text: string][] = [["before", "CHANGE\nGO"], ["between", "GO\nCHANGE\nGO"], ["in-loop", "hook = i => {\n  if (i === 1) {\n    CHANGE\n  }\n};\nGO\nGO"], ["last-iteration", "hook = i => {\n  if (i === 3) {\n    CHANGE\n  }\n};\nGO"], ["many-before", "for (let k = 0; k < 60; k++) {\n  GO\n}\nCHANGE\nGO"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["four", "for (let i = 0; i < 4; i++) {\n  hook(i);\n  DO\n}"], ["change-behind", "for (let i = 0; i < 4; i++) {\n  DO\n  hook(i);\n}"], ["both-sides", "for (let i = 0; i < 3; i++) {\n  DO\n  hook(i);\n  DO2\n}"], ["once", "{\n  const i = 1;\n  hook(i);\n  DO\n}"], ["while", "let i = 0;\nwhile (i < 5) {\n  DO\n  hook(i);\n  i++;\n}"], ["without-call", "for (let i = 0; i < 6; i++) {\n  DO\n}\nhook(1);"]]; // prettier-ignore
const declarations: [name: string, text: string][] = [["let", "let buffer, view, other;"], ["var", "var buffer, view, other;"], ["null-first", "let buffer = null,\n  view = null,\n  other = null;"], ["typed-first", "let view = new K(1),\n  other = new Uint8Array(1),\n  buffer = view.buffer;"]]; // prettier-ignore
const total = kinds.length * buffers.length * indexes.length * accesses.length * changes.length * moments.length * loops.length * declarations.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const change = pick(changes);
  const access = pick(accesses);
  const index = pick(indexes);
  const kind = pick(kinds);
  const moment = pick(moments);
  const buffer = pick(buffers);
  const loop = pick(loops);
  const declared = pick(declarations);
  const isCommon = cell % 3 === 0 && change[0] !== "frozen";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const one = kind[1].startsWith("Big") ? "3n" : "3";
  const fill = (text: string) => text.replaceAll(/\bK\b/g, kind[1]).replaceAll(/\bONE\b/g, one).replaceAll(/\bAT\b/g, index[1]); // prettier-ignore
  const guarded = (text: string) => `try {\n${indent(text, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`;
  const deed = fill(access[1]);
  const again = deed.replaceAll(/\bconst x\b/g, "const y").replaceAll(/= x;|\(x\)/g, text => text.replace("x", "y"));
  const body = within(within(loop[1], "DO2", again), "DO", deed);
  const lines = [
    fill(declared[1]),
    "let hook = i => i;",
    "let sum = 0;",
    "const out = [];",
    `function make() {\n${indent(fill(buffer[1]), "  ")}\n  for (let i = 0; i < 8; i++) other[i] = i * 5 + 1;\n}`,
    `function run(p) {\n${indent(body, "  ")}\n}`,
    "make();",
    within(within(moment[1], "CHANGE", guarded(fill(change[1]))), "GO", guarded("run(4);")),
    "const show = value => (Object.is(value, -0) ? '-0' : typeof value === 'bigint' ? value + 'n' : String(value));",
    "const list = values => {\n  try {\n    return Array.from(values ?? []).map(show).join().slice(0, 300);\n  } catch (error) {\n    return error.name;\n  }\n};",
    "console.log(out.map(show).join().slice(-700), sum, list(view), list(other));",
  ];
  return {
    name: `${kind[0]}--${buffer[0]}--${index[0]}--${access[0]}--${change[0]}--${moment[0]}--${loop[0]}--${declared[0]}.${isCommon ? "cjs" : "mjs"}`,
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
