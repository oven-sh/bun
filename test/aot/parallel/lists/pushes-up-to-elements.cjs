// The bound of a loop that pushes is an element: a number out of a view, or nothing.
const upTo = JSON.parse("[0,1,2,3,4,5,6]"), halves = JSON.parse("[0.5,2.5]"), data = JSON.parse('[{"x":3},{"x":"four"},{"x":5.5},{"x":null}]');
function make(a, b) { const list = new Array(2); list[0] = a; list.push(b); return list.length + ":" + list[0] + ":" + list[1] + ":" + list[2]; }
function run(turn) { let text = ""; for (let i = 0; i < upTo[4]; i++) text += "|" + make(data[i].x, i, turn); return text; }
function fill(bounds, place) { const list = []; for (let i = 0; i < bounds[place]; i++) list.push(i); return list.length; }
function fillBoth(bounds, place) { const list = [], other = []; for (let i = 0; i < bounds[place]; i++) { list.push(i); other.push(list, i); } return list.length + other.length; }
globalThis.handed = [run, make, fill, fillBoth];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
for (const bounds of [upTo, halves, new Float64Array([1.5, NaN, 7]), new Float32Array(4).fill(3), new Uint8Array([9, 200]), [1, , 3], ["2", 3n], []])
  console.log([0, 1, 2, 9].map(place => [fill(bounds, place), fillBoth(bounds, place)].join()).join(" "));
