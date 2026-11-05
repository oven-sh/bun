// The programs of untyped-loops that are one text but for a few places.
import { family, programsOf } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `number-becomes-string.js			ypeof total === "string" ? total.length : t	mixed	6
one-string-in-a-thousand.js		 * 1		rarelyText	30
overflowing-integers.js	214748300			integers	30
sum-of-doubles.js		 / 3.7		integers	30
sum-of-fractions.js				fractions	30
sum-of-integers.js				integers	30`,
      (
        a,
        b,
        c,
        d,
        e,
      ) => `// The elements come out of JSON.parse, so that nothing about them is known before the program runs. The list itself is an array of the program.
function make(kind, length) {
  var items = [];
  for (var i = 0; i < length; i++) {
    var n = (i * 7919 + 13) % 1000;
    if (kind === "integers") items.push(n);
    else if (kind === "fractions") items.push(n + 0.25);
    else if (kind === "words") items.push("w" + (n % 10));
    else if (kind === "mixed") items.push(i === length >> 1 ? "x" : n);
    else if (kind === "rarelyText") items.push(i % 1000 === 999 ? String(n) : n);
    else if (kind === "permutation") items.push((i * 7 + 3) % length);
  }
  var parsed = JSON.parse(JSON.stringify({ items: items }));
  var copy = [];
  for (var j = 0; j < length; j++) copy.push(parsed.items[j]);
  return copy;
}

function kernel(values) {
  var total = ${a}0;
  for (var i = 0; i < values.length; i++) total += values[i]${b};
  return t${c}otal;
}

var input = make("${d}", 1000);
var checksum = 0;
for (var round = 0; round < ${e}000; round++) checksum = (checksum + kernel(input)) % 1000000007;
console.log(checksum);
`,
    ),
    ...family(
      `loops-over-the-elements-of-int8array.js	Int8Array	Int16Array
loops-over-the-elements-of-uint8clampedarray.js	Uint8ClampedArray	Int8Array
loops-over-the-elements-of-int16array.js	Int16Array	Uint16Array
loops-over-the-elements-of-uint16array.js	Uint16Array	Int16Array
loops-over-the-elements-of-int32array.js	Int32Array	Uint32Array
loops-over-the-elements-of-uint32array.js	Uint32Array	Int32Array
loops-over-the-elements-of-float32array.js	Float32Array	Float64Array
loops-over-the-elements-of-float64array.js	Float64Array	Float32Array`,
      (kind, other) => `// Loops that read and store the elements of an object nobody can follow, in a program that constructs views of one kind beside bytes, while the view is shrunk, grown, detached, or given other members.
const given = JSON.parse('{"chunks":[]}');
function hide(value) {
  given.chunks[0] = value;
  return given.chunks[0];
}
let said = "";
function say(name, run) {
  let text = "threw";
  try {
    text = run();
  } catch {}
  said += name + " = " + text + "\\n";
}
function show(view) {
  let text = "";
  for (let i = 0; i < view.length; i++) text += view[i] * 1 + ",";
  return text;
}

function sum(view) {
  let s = 0;
  for (let i = 0; i < view.length; i++) s = s + view[i];
  return s;
}
function dot(left, right) {
  let s = 0;
  for (let i = 0; i < left.length; i++) s += left[i] * right[i];
  return s;
}
function join(view, from, to, step) {
  let s = 0;
  let text = "";
  for (let i = from; i < to; i += step) {
    s = view[i] * 2;
    text += s + ",";
  }
  return text;
}
function fill(view, from, to, value) {
  for (let i = from; i < to; i++) view[i] = value + i;
  return show(view);
}
function scale(view, by) {
  for (let i = 0; i < view.length; i++) view[i] = view[i] * by;
  return show(view);
}
function sumWhile(view, each) {
  let s = 0;
  for (let i = 0; i < view.length; i++) {
    s += view[i] + 1;
    each(i);
  }
  return s + "," + view.length;
}
function sumTo(view, count, each) {
  let s = 0;
  let text = "";
  for (let i = 0; i < count; i++) {
    each(i);
    s = view[i] - 1;
    text += s + ",";
  }
  return text + view.length;
}
function storeWhat(view, values) {
  for (let i = 0; i < values.length; i++) view[i] = values[i] * 1;
  return show(view);
}
function nested(rows, view) {
  let s = 0;
  for (let r = 0; r < rows; r++) for (let i = 0; i < view.length; i++) s = (s + view[i] * (r + 1)) | 0;
  return s;
}
function counted(view) {
  view[0] = 1;
  view[1] = 2;
  view[2] = 3;
  view[3] = 4;
  return view;
}
function resizable(count, most) {
  const buffer = new ArrayBuffer(count * ${kind}.BYTES_PER_ELEMENT, { maxByteLength: most * ${kind}.BYTES_PER_ELEMENT });
  const tracking = new ${kind}(buffer);
  for (let i = 0; i < count; i++) tracking[i] = i + 1;
  return buffer;
}

{
  const odd = [1.9, -1.9, NaN, 300.5, -300.5, 65537, 4294967297, -0, Infinity, 1e40];
  for (let round = 0; round < 3; round++) {
    {
      const size = ${kind}.BYTES_PER_ELEMENT;
      const some = () => new ${kind}([1, 2, 3, 250]);
      say("sum", () => sum(hide(some())) + "," + sum(hide(new ${kind}(0))) + "," + sum(hide(new ${kind}(new ${kind}([9, 1, 2, 3]).buffer, size, 2))));
      say("dot", () => dot(hide(some()), hide(some())) + "," + dot(hide(some()), hide([1, 2])) + "," + dot(hide([1, 2, 3, 4, 5]), hide(some())));
      say("join", () => join(hide(some()), -2, 6, 1) + join(hide(some()), -1, 3, 0.5) + join(hide(some()), 4294967294, 4294967298, 1));
      say("fill", () => fill(hide(some()), -1, 6, 300.7) + fill(hide(some()), 0, 4, -1.5));
      say("scale", () => scale(hide(some()), 1000.5) + scale(hide(some()), -0.5) + scale(hide(some()), NaN));
      say("store", () => storeWhat(hide(new ${kind}(odd.length)), hide(odd)));
      say("nested", () => nested(3, hide(some())));
      const views = [
        ["tracking", buffer => new ${kind}(buffer)],
        ["tracking at an offset", buffer => new ${kind}(buffer, 2 * size)],
        ["fixed", buffer => new ${kind}(buffer, 0, 6)],
        ["fixed at an offset", buffer => new ${kind}(buffer, 2 * size, 4)],
      ];
      for (const [how, view] of views) {
        const name = how;
        say("shrunk " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(4 * size); }); });
        say("shrunk to nothing " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(0); }); });
        say("shrunk and grown " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 1) b.resize(size); if (i === 3) b.resize(12 * size); }); });
        say("grown " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.resize(12 * size); }); });
        say("transferred " + name, () => { const b = resizable(8, 16); return sumWhile(hide(view(b)), i => { if (i === 2) b.transfer(); }); });
        say("counted while shrunk " + name, () => { const b = resizable(8, 16); return sumTo(hide(view(b)), 8, i => { if (i === 3) b.resize(2 * size); }); });
        say("counted while detached " + name, () => { const b = resizable(8, 16); return sumTo(hide(view(b)), 8, i => { if (i === 3) b.transfer(4); }); });
        say("stored while shrunk " + name, () => { const b = resizable(8, 16); return storeWhat(hide(view(b)), hide([1, 2, { valueOf() { b.resize(2 * size); return 3; } }, 4, 5, 6])); });
        say("stored while detached " + name, () => { const b = resizable(8, 16); return storeWhat(hide(view(b)), hide([1, 2, { valueOf() { b.transfer(); return 3; } }, 4, 5, 6])); });
      }
      say("detached", () => { const v = some(); return sumWhile(hide(v), i => { if (i === 1) v.buffer.transfer(); }); });
      say("detached before", () => { const v = some(); v.buffer.transfer(); return sum(hide(v)) + join(hide(v), 0, 3, 1) + fill(hide(v), 0, 3, 1); });
      say("detached by the other side", () => { const v = some(); return dot(hide(v), hide([1, { valueOf() { v.buffer.transfer(); return 2; } }, 3, 4])); });
      say("shared and grown", () => {
        const b = new SharedArrayBuffer(4 * size, { maxByteLength: 16 * size });
        const v = new ${kind}(b);
        return sumWhile(hide(v), i => { v[i] = i + 1; if (i === 2) b.grow(7 * size); });
      });
      class OwnLength extends ${kind} {
        get length() {
          return 2;
        }
      }
      class LongLength extends ${kind} {
        get length() {
          return 6;
        }
      }
      say("own length", () => sum(hide(counted(new OwnLength(4)))) + "," + sum(hide(counted(new LongLength(4)))) + "," + scale(hide(counted(new LongLength(4))), 2));
      say("length on the instance", () => { const v = some(); Object.defineProperty(v, "length", { value: 2 }); return sum(hide(v)); });
      say("length defined in the loop", () => { const v = some(); return sumWhile(hide(v), i => { if (i === 0) Object.defineProperty(v, "length", { value: 2, configurable: true }); }); });
      say("prototype of arrays", () => { const v = some(); Object.setPrototypeOf(v, Array.prototype); return sum(hide(v)) + join(hide(v), 0, 5, 1); });
      say("no prototype", () => { const v = some(); Object.setPrototypeOf(v, null); return sum(hide(v)) + join(hide(v), 0, 5, 1); });
      say("prototype with elements", () => { const v = new ${kind}([1, 2]); Object.setPrototypeOf(v, { length: 4, 2: 20, 3: 30, "-1": 40, 1.5: 50 }); return join(hide(v), -1, 4, 0.5); });
      say("prototype swapped in the loop", () => { const v = some(); return sumWhile(hide(v), i => { if (i === 1) Object.setPrototypeOf(v, { length: 3 }); }); });
      say("prototype of another kind", () => { const v = some(); Object.setPrototypeOf(v, ${other}.prototype); return sum(hide(v)) + "," + scale(hide(v), 1.5); });
      say("object below a view", () => { const o = Object.create(some()); return join(hide(o), 0, 4, 1) + fill(hide(o), 0, 4, 1); });
    }
  }
  console.log(said);
}
`,
    ),
    ...family(
      `loops-over-the-elements-of-int8array.json
loops-over-the-elements-of-uint8clampedarray.json
loops-over-the-elements-of-int16array.json
loops-over-the-elements-of-uint16array.json
loops-over-the-elements-of-int32array.json
loops-over-the-elements-of-uint32array.json
loops-over-the-elements-of-float32array.json
loops-over-the-elements-of-float64array.json`,
      () => `{ "runWithASAN": "views are shrunk, grown and detached inside loops that read and store their elements" }\n`,
    ),
  });
