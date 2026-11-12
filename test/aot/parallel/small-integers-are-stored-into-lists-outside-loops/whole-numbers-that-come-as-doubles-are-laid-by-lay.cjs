var AT = []; for (var at = 0; at < 81; at++) AT[at] = at;
function Grid() { this.cells = []; for (var k = 0; k < 12; k++) this.cells[k] = 0; this.laid = 0; }
Grid.prototype.lay = function (cell, digit) { this.cells[AT[cell]] = digit; this.laid++; return this.deeper(cell, digit); };
Grid.prototype.layWhole = function (cell, digit) { if (digit === (digit | 0)) { this.cells[AT[cell]] = digit; this.laid++; } return this.deeper(cell, digit); };
Grid.prototype.layTested = function (cell, digit) { if (typeof digit === "number" && digit >= 0 && digit < 100 && digit % 1 === 0) { this.cells[AT[cell]] = digit; this.laid++; } return this.deeper(cell, digit); };
Grid.prototype.deeper = function (cell, digit) { return cell > 90 ? this.lay(cell - 1, digit) : this.laid; };
var hide = new Function("x", "return x;");
function health(list) {
  var sum = 0; for (var k = 0; k < list.length; k++) sum += list[k];
  var sorted = list.slice().sort(function (a, b) { return a - b; });
  return [sum, list.includes(3), list.indexOf(3), list.lastIndexOf(3), list.includes(7), list.join(), JSON.stringify(list), Math.max.apply(null, list), sorted.join(), list.concat([1]).length, list.map(function (x) { return x + 1; }).join(), Object.is(list[2], -0), Object.is(list[2], 0), list.filter(function (x) { return x === 3; }).length, structuredClone(list).join()].join("|");
}
var said = [];
var doubles = [1.5, 3, 7, 0.5]; var floats = new Float64Array([3, 7, -0, 2147483647, 2147483648, -2147483648, -2147483649, 3.5]); var halves = hide(1.5);
var wholes = [hide(doubles)[1], hide(doubles)[2], floats[0], floats[1], halves + halves, hide(doubles).slice().pop() * 6, Reflect.get(hide(doubles), 1), Math.floor(hide(3.7)), Math.round(hide(6.6)), hide(9) / 3, hide(21) / hide(3), Math.sqrt(hide(9)), Number("3.0"), parseFloat("7.0"), JSON.parse("3.0"), JSON.parse("[7.0]")[0], hide(1e0) * 3, Math.pow(hide(3), 1), Math.abs(hide(-3)), hide(6.5) - 3.5, new DataView(new Float64Array([3]).buffer).getFloat64(0, true)];
for (var n = 0; n < wholes.length; n++) { var grid = new Grid(); for (var t = 0; t < 6; t++) grid.lay((n + t) % 12, wholes[n]); said.push(n + " " + health(grid.cells)); }
console.log(said.join("\n"));
