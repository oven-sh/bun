// The same draw where the number from outside is below zero, a fraction, no number, a text or a bigint, and where the drum is a list, a text, a view of another kind, short, or empty.
function loaded(drum, tickets, turn, limit) {
  var weight = 0;
  var at = 0;
  var blanks = 0;
  while (weight < limit && at < tickets.length) {
    var lot = drum[tickets[at] & turn];
    at += 1;
    if (lot === undefined) blanks += 1;
    else weight += lot;
  }
  return at + " tickets, " + blanks + " blanks, " + weight;
}
function told(drum, tickets, turn, limit) {
  try {
    return loaded(drum, tickets, turn, limit);
  } catch (error) {
    return error.constructor.name;
  }
}
var drum = new Uint8Array(60).map(function (_, n) { return (n * 7) % 50; });
var tickets = new Uint8Array(300).map(function (_, n) { return n * 37; });
for (var round = 0; round < 200; round++) loaded(drum, tickets, 63, 500);
[63, 0, -1, 7.9, NaN, "15", null, undefined, 2 ** 32 + 5, -(2 ** 31), { valueOf: function () { return 31; } }, 3n, Symbol.iterator].forEach(function (turn) {
  console.log(typeof turn, told(drum, tickets, turn, 900));
});
[[1, 2, 3], "12345678", new Float64Array([0.5, 1.5, NaN, -0]), new Int16Array([-5, 5]), new Uint8Array(0), [, 4], { 1: 5, 3: 6 }, null].forEach(function (other) {
  console.log(told(other, tickets, 7, 900));
});
[[5, 70000, -1, 2.5, "3"], new Uint16Array([300, 65535]), Buffer.from([1, 2, 250]), [1n], []].forEach(function (other) {
  console.log(told(drum, other, 255, 900));
});
var gone = new Uint8Array(60).fill(4);
structuredClone(gone.buffer, { transfer: [gone.buffer] });
console.log(told(gone, tickets, 63, 900));
