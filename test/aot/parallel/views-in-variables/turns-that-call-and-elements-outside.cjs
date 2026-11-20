// Turns of a loop read views out of variables, compare elements that may lie outside as unsigned numbers, and some turns call what stores into the variables.
var keys, flags, steps = [], calls = 0;
function unsigned(value) {
  if (value >= 0) return value;
  return value + 4294967296;
}
function grow(at) {
  calls++;
  if (calls === 40) keys = new Float64Array([2.5, -1, NaN, 70000, 3]);
  if (calls === 60) flags = new Uint8Array(3);
  if (calls === 80) keys = new Uint16Array(24).fill(7);
  if (calls === 95) keys = undefined;
  return at;
}
function mark(at) {
  flags[at & 7] ^= 1;
  calls = (calls + 1) | 0;
}
steps.push(grow, mark);
function pass(from) {
  var at = from, first, second, moved = 0;
  while (true) {
    first = keys[(at + -4) >> 1];
    second = keys[(at + 6) >> 1];
    if ((flags[at & 15] & 1) == 0) {
      keys[at >> 1] = (first + 1) | 0;
    } else if (!(unsigned(first) < unsigned(second))) {
      first = keys[(at + 30) >> 1];
      if (!(unsigned(second) >= unsigned(first))) {
        steps[moved & 1](at);
        second = keys[at >> 1];
        if (!(second == 0)) steps[(moved + 1) & 1](at);
      }
      moved++;
    }
    first = keys[at >> 1];
    second = keys[(at + -2) >> 1];
    keys[at >> 1] = second;
    keys[(at + -2) >> 1] = first;
    if (unsigned(first) >= unsigned(keys[(at + -8) >> 1])) moved = (moved + 2) | 0;
    if (at < 1) break;
    at = (at + -2) | 0;
  }
  return moved;
}
function begin() {
  keys = new Uint16Array(16);
  flags = new Uint8Array(16);
  for (var i = 0; i < 16; i++) {
    keys[i] = (i * 40503) & 65535;
    flags[i] = i * 5;
  }
}
begin();
var sums = [];
for (var turn = 0; turn < 60; turn++) {
  try {
    sums.push(pass(8 + ((turn * 6) & 31)));
  } catch (error) {
    sums.push(error.name);
    begin();
  }
}
console.log(sums.join(" "), calls, Array.from(keys).join(" "), Array.from(flags).join(" "));
