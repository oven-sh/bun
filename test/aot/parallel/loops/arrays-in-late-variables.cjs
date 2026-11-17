// Variables that are declared without a value: they may still be in their dead zone, hold undefined, an array, or something else when a loop starts.
const show = (value) => Array.isArray(value) || ArrayBuffer.isView(value)
  ? "[" + Array.from(value, (element) => typeof element === "symbol" ? "symbol" : Object.is(element, -0) ? "-0" : Array.isArray(element) ? show(element) : String(element)).join() + (Object.keys(value).length > value.length ? " " + Object.keys(value).slice(value.length).join() : "") + "]"
  : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value);
const fill = (length, element) => { const made = []; for (let i = 0; i < length; i++) made.push(element(i)); return made; };
const holes = (length, element) => { const made = []; for (let i = 0; i < length; i++) if (i % 3 !== 1) made[i] = element(i); return made; };
const attempt = (run) => { try { return show(run()); } catch (error) { return error.constructor.name; } };

const steps = {
  copy() { for (let i = 0; i < count; i++) target[i] = source[i]; },
  increment() { for (let i = 0; i < count; i++) target[i] = source[i] + 1; },
  add() { for (let i = 0; i < count; i++) target[i] += source[i]; },
  smooth() { for (let i = 1; i < count - 1; i++) target[i] = (source[i - 1] + source[i] + source[i + 1]) / 3; },
  shift() { for (let i = 1; i < count; i++) source[i - 1] = source[i]; },
  reverse() { for (let i = 0, j = count - 1; i < j; i++, j--) { const kept = source[i]; source[i] = source[j]; source[j] = kept; } },
  histogram() { for (let i = 0; i < count; i++) target[source[i] & 3]++; },
  sum() { let total = 0; for (let i = 0; i < count; i++) total += source[i]; return total; },
  pairs() { let total = 0; for (let i = 0; i < count; i++) for (let j = 0; j < i; j++) if (source[i] === source[j]) total++; return total; },
  rows() { let total = 0; for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) total += grid[y][x]; return total; },
  incrementRows() { for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) grid[y][x] = grid[y][x] + 1; },
  transpose() { for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) turned[x][y] = grid[y][x]; },
  reassign() { let total = 0; for (let y = 0; y < side; y++) { for (let x = 0; x < side; x++) total += grid[y][x]; if (y === 1) grid = turned; } return total; },
  shorten() { let total = 0; for (let i = 0; i < count; i++) { total += source[i]; if (i === 2) count = 4; } return total; },
  forget() { let total = 0; for (let i = 0; i < count; i++) { total += source[i]; if (i === 2) source = undefined; } return total; },
};
const names = Object.keys(steps);
for (const name of names) console.log(name, "before the declarations", attempt(steps[name]));
let source;
let target;
let grid;
let turned;
let count;
let side;
for (const name of names) console.log(name, "undefined", attempt(steps[name]));

const numbers = [
  ["integers", (i) => (i * 7) % 5], ["fractions", (i) => i + 0.5], ["both", (i) => i % 4 ? i : i + 0.25], ["strings", (i) => "s" + i], ["large", (i) => 2147483640 + i], ["negative zeros", (i) => i % 2 ? -0 : 0],
  ["NaNs", (i) => i % 3 ? NaN : i], ["undefined", (i) => i % 3 ? undefined : i], ["whole", (i) => 2 ** 40 + i], ["objects", (i) => ({ valueOf() { return i; } })], ["BigInts", (i) => BigInt(i)],
];
const counts = [6, 4, 0, -1, 2.5, undefined, null, "3", NaN, Infinity];
function assign(element, makeArray, size) {
  source = makeArray(6, element); target = fill(6, (i) => i);
  grid = fill(4, (y) => makeArray(4, (x) => element(y * 4 + x))); turned = fill(4, () => fill(4, () => 0));
  count = size === Infinity ? 6 : size; side = typeof size === "number" && size > 4 ? 4 : size;
}
for (const name of names) {
  for (const [kind, element] of numbers) {
    let line = name + " " + kind;
    for (const makeArray of [fill, holes]) {
      for (const size of kind === "integers" ? counts : [6]) {
        assign(element, makeArray, size);
        line += " | " + attempt(steps[name]) + " " + show(source) + show(target) + show(grid) + (name === "transpose" ? show(turned) : "");
      }
    }
    console.log(line);
  }
  assign((i) => i, fill, 6); source = new Float64Array(source); console.log(name, "a view", attempt(steps[name]), show(source));
  assign((i) => i, fill, 6); target = Object.freeze(target); console.log(name, "frozen", attempt(steps[name]), show(target));
  assign((i) => i, fill, 6); source = { 0: 1, 1: 2 }; grid = [[1, 2, 3, 4], undefined]; console.log(name, "others", attempt(steps[name]));
  assign((i) => i, fill, 6); grid[2] = grid[1]; turned = grid; target = source; console.log(name, "the same", attempt(steps[name]), show(source), show(grid));
}
