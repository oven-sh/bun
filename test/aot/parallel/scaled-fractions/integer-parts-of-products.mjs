// Math.floor() of a fraction below 1 times a count is an integer below the count.
let state = 12345;
const bits = () => (state = (Math.imul(state, 1103515245) + 12345) | 0) >>> 0;
const edges = [0, 1, 2, 0x7fffffff, 0x80000000, 0x80000001, 0xfffffffe, 0xffffffff];
const counts = [0, 1, 2, 3, 5, 52, 255, 65535, 65537, 2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, 2 ** 33, -1, -7, 1.5, -0, NaN, Infinity];
const fraction = () => bits() / 0x1_0000_0000;
const signed = () => (bits() | 0) / 0x1_0000_0000;
const wide = () => bits() / 0xffff_ffff;
const show = n => (Object.is(n, -0) ? "-0" : String(n));
function floors(count, n) { let text = ""; for (let i = 0; i < n; i++) text += show(Math.floor(fraction() * count)) + " "; return text; }
function truncs(count, n) { let text = ""; for (let i = 0; i < n; i++) text += show(Math.trunc(count * fraction())) + " "; return text; }
function signedFloors(count, n) { let text = ""; for (let i = 0; i < n; i++) text += show(Math.floor(signed() * count)) + " "; return text; }
function wideFloors(count, n) { let text = ""; for (let i = 0; i < n; i++) text += show(Math.floor(wide() * count)) + " "; return text; }
function ceils(count, n) { let text = ""; for (let i = 0; i < n; i++) text += show(Math.ceil(fraction() * count)) + show(Math.round(fraction() * count)) + " "; return text; }
for (const count of counts) console.log(show(count), floors(count, 4), truncs(count, 4), signedFloors(count, 4), wideFloors(count, 3), ceils(count, 3));
function edgeFloor(edge, count) { return Math.floor((edge >>> 0) / 4294967296 * count); }
function edgeFloorOfInt(edge, count) { return Math.floor((edge >>> 0) / 4294967296 * (count | 0)); }
function edgeFloorOfLength(edge, list) { return Math.floor(list.length * ((edge >>> 0) / 4294967296)); }
for (const edge of edges) console.log(edge, counts.map(count => show(edgeFloor(edge, count))).join(" "), counts.map(count => show(edgeFloorOfInt(edge, count))).join(" "), edgeFloorOfLength(edge, "abcdef"), edgeFloorOfLength(edge, [1, 2, 3]), edgeFloorOfLength(edge, new Array(4294967295)));
function pick(list, n) { let text = ""; for (let i = 0; i < n; i++) text += list[Math.floor(fraction() * list.length)]; return text; }
console.log(pick([..."abcdefg"], 30), pick([1, 2.5, 3], 20), pick("string", 12), pick([], 3));
function shuffle(list) { for (let i = list.length; i !== 0;) { const at = Math.floor(fraction() * i); i--; const held = list[i]; list[i] = list[at]; list[at] = held; } return list; }
console.log(shuffle([..."abcdefghijklm"]).join(""), shuffle([1, 2, 3, 4.5, 6]).join(), shuffle([{ id: 1 }, { id: 2 }, { id: 3 }]).map(o => o.id).join());
let inRange = true, low = 9, high = -1;
for (let i = 0; i < 20000; i++) { const n = Math.floor(Math.random() * 6); inRange &&= Number.isInteger(n) && n >= 0 && n < 6 && !Object.is(n, -0); low = Math.min(low, n); high = Math.max(high, n); }
console.log(inRange, low, high, Object.is(Math.floor(Math.random() * 0), 0), Number.isNaN(Math.floor(Math.random() * undefined)));
