function range(start, end, step) { if (arguments.length === 1) { end = start; start = 0; } if (arguments.length < 3) step = 1; var n = 0; for (var v = start; v < end; v += step) n = n * 3 + v; return n; }
function kinds(a, b) { if (arguments.length === 0) return "none"; if (arguments.length === 1) return a + "!"; var n = 0; for (var i = a; i < b; i++) n += i; return arguments.length > 2 ? [n] : n; }
function notEqual(a, b) { if (arguments.length !== 2) b = 3; var n = 0; for (var i = a; i <= b; i++) n = n * 2 + i; return n; }
function late(a) { var n = 0; for (var i = 0; i < 2; i++) n += i; if (arguments.length > 1) { for (var j = 0; j < a; j++) n += 10; } return n; }
var carried = 0, texts = "";
for (var turn = 0; turn < 30; turn++) {
  carried += range(turn & 3) + range(1, 4) + range(0, 6, 2) + range(5, 1) + range(3, 3, 1) + range(0, 8) + range(0, 9) + range(-2, 2) + range(0, 4, 1, 7);
  carried += kinds(1, 4) + kinds(2, 2) + notEqual(1, 2) + notEqual(1) + notEqual(1, 2, 3) + late(3) + late(3, 0);
  texts = kinds() + kinds(turn) + kinds(1, 3, 0).length;
}
console.log(carried, texts, range(), range(2.5), range(0, 2.5), range(0, 3, 0.5), range("2"), range(0, "3"), String(range(0, 2, undefined)));
