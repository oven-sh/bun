// Arrays and widths in captured variables and in variables of the file, under keys that the iterations compute. They are read and checked before the loop of the access.
// Some loops assign the variables, or call what assigns them.
const show = (value) => Array.isArray(value) || ArrayBuffer.isView(value)
  ? "[" + Array.from(value, (element) => typeof element === "symbol" ? "symbol" : Object.is(element, -0) ? "-0" : String(element)).join() + (Object.keys(value).length > value.length ? " " + Object.keys(value).slice(value.length).join() : "") + "]"
  : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value);
const fill = (length, element) => { const made = []; for (let i = 0; i < length; i++) made.push(element(i)); return made; };
const holes = (length, element) => { const made = []; for (let i = 0; i < length; i++) if (i % 3 !== 1) made[i] = element(i); return made; };
let calls = 0;

function makeGrid() {
  var width;
  var height;
  let source;
  let target;
  let other = fill(16, (i) => 100 + i);
  function assign(w, h, s, t) { width = w; height = h; source = s; target = t; }
  function copy() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[x + y * width] = source[x + y * width]; }
  function increment() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[y * width + x] = source[y * width + x] + 1; }
  function sum() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) total += source[x + y * width]; return total; }
  function blur() { for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) { const row = y * width; target[x + row] = (source[x + row] + source[x - 1 + row] + source[x + 1 + row] + source[x + (y - 1) * width] + source[x + (y + 1) * width]) / 5; } }
  function reassign() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (y === 1 && x === 1) source = other; } return total; }
  function reassignTarget() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { target[x + y * width] = x; if (y === 1 && x === 1) target = other; } }
  function widen() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (y === 1 && x === 1) width = width - 1; } return total; }
  function swap() { const kept = source; source = other; other = kept; calls++; return 1; }
  function call() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (x === 2) total += swap(); } return total; }
  function shrink() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (y === 2 && x === 0) source.length = 5; } return total; }
  function wrap() { let total = 0; for (let k = 0; k < 40; k++) total += source[(k * 3 + width) & 15]; return total; }
  function pop() { let total = 0; let top = 8; while (top > 0 && source[top - 1] !== undefined) { total += source[--top]; source[top + 1] = total; } return total; }
  function state() { return [width, height, source, target].map(show).join(" "); }
  return { assign, copy, increment, sum, blur, reassign, reassignTarget, widen, call, shrink, wrap, pop, state };
}

let width;
let height;
let source;
let target;
let spare = fill(16, (i) => 200 + i);
const file = {
  assign(w, h, s, t) { width = w; height = h; source = s; target = t; },
  copy() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[x + y * width] = source[x + y * width]; },
  increment() { for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) target[y * width + x] = source[y * width + x] + 1; },
  sum() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) total += source[x + y * width]; return total; },
  reassign() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (y === 1 && x === 1) source = spare; } return total; },
  widen() { let total = 0; for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { total += source[x + y * width]; if (y === 1 && x === 1) width = width - 1; } return total; },
  wrap() { let total = 0; for (let k = 0; k < 40; k++) total += source[(k * 3 + width) & 15]; return total; },
  state() { return [width, height, source, target].map(show).join(" "); },
};

const numbers = [
  ["integers", () => fill(16, (i) => i)],
  ["fractions", () => fill(16, (i) => i + 0.5)],
  ["both", () => fill(16, (i) => i % 4 ? i : i + 0.25)],
  ["holes", () => holes(16, (i) => i)],
  ["fractions with holes", () => holes(16, (i) => i + 0.5)],
  ["strings", () => fill(16, (i) => "s" + i)],
  ["large", () => fill(16, (i) => 2147483640 + i)],
  ["short", () => fill(5, (i) => i)],
  ["view", () => new Float64Array(16).map((element, i) => i + 0.5)],
  ["bytes", () => new Uint8Array(16).map((element, i) => i * 20)],
  ["frozen", () => Object.freeze(fill(16, (i) => i))],
  ["undefined", () => undefined],
  ["an object", () => ({ 0: 1, 1: 2, length: 3 })],
];
const widths = [4, 3, 4.5, 0, -2, undefined, null, "4", NaN, 2 ** 21, -0, true];
for (const grid of [makeGrid(), file]) {
  for (const name of Object.keys(grid)) {
    if (name === "assign" || name === "state") continue;
    for (const [kind, make] of numbers) {
      let line = name + " " + kind;
      for (const w of kind === "integers" || kind === "fractions" ? widths : [4, undefined]) {
        grid.assign(w === 2 ** 21 ? 4 : w, w === 2 ** 21 ? 1 : 4, make(), name === "copy" ? fill(16, () => 0) : fill(16, () => 0.5));
        if (w === 2 ** 21) grid.assign(w, name === "reassignTarget" || name === "copy" || name === "increment" ? 0 : 1, make().length ? make().slice(0, 4) : make(), []);
        if (w === 2 ** 21 && name !== "wrap" && name !== "pop") continue;
        try { line += " | " + show(grid[name]()); } catch (error) { line += " | " + error.constructor.name; }
        line += " " + grid.state();
      }
      console.log(line);
    }
  }
}
console.log(calls);
