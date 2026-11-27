// STATISTIC: UnrolledLoopsEmitted >= 4
// Unrolled iterations hand on values that their arms join (the best, its place, a mask): a hole, or what is no number, stands at each place of the list in turn.
function fewest(cells, bits, k) {
  var best = -1, least = 10, mask = 0;
  for (var i = 0; i < cells.length; i++) {
    if (cells[i]) continue;
    var n = bits[(i * 7 + k) & 63];
    if (n < least) { least = n; best = i; mask = n + k; if (n <= 0) break; }
  }
  return best + "," + least + "," + mask;
}
function greatest(list) { var best = -Infinity, at = -1; for (var i = 0; i < list.length; i++) if (list[i] > best) { best = list[i]; at = i; } return best + "," + at; }
function runs(list) { var longest = 0, run = 0; for (var i = 0; i < list.length; i++) { if (list[i] & 1) run++; else run = 0; if (run > longest) longest = run; } return longest + "," + run; }
function clamped(list) { var s = 0, cut = 0; for (var i = 0; i < list.length; i++) { var x = list[i] + 1; if (x > 5) { x = 5; cut++; } s = (s + x) | 0; } return s + "," + cut; }
function longestView(views, kind) { var v = views[kind], best = 0; for (var k = 0; k < v.length; k++) best = v[k] > best ? v[k] : best; return best; }
function shown(x) { return Object.is(x, -0) ? "-0" : String(x); }
var odd = [["a hole", 0], ["undefined", undefined], ["NaN", NaN], ["a fraction", 2.5], ["minus zero", -0], ["past an int32", 1099511627776], ["the least int32", -2147483648], ["endless", Infinity], ["null", null], ["a text", "12"], ["true", true], ["an object", { valueOf: function () { return 12; } }]];
var bits = []; for (var m = 0; m < 64; m++) bits[m] = (m * 5) % 11;
var uses = [function fewestOf(list) { return fewest(list, bits, list.length); }, greatest, runs, clamped];
uses.forEach(function (use) {
  var plain = [0, 1, 7, 8, 9, 24, 33].map(function (length) { return shown(use(Array.from({ length: length }, function (_, i) { return (i * 37) % 11 - 2; }))) + " " + shown(use(Array.from({ length: length }, function (_, i) { return i * 1.5 - 3; }))); });
  console.log(use.name, plain.join(" "));
  odd.forEach(function (pair) {
    var said = [];
    for (var at = 0; at < 18; at++) {
      var list = []; for (var i = 0; i < 18; i++) list.push((i * 37) % 11 - 2);
      if (pair[0] === "a hole") delete list[at]; else list[at] = pair[1];
      said.push(shown(use(list)));
    }
    console.log(use.name, pair[0], said.join(" "));
  });
});
var views = [new Int8Array(19).fill(3), new Uint8Array(19).fill(200), new Float64Array(19).fill(0.5), new Uint32Array(3).fill(4000000000), [1, 2, , 9]];
for (var v = 0; v < views.length; v++) console.log(v, longestView(views, v));
