// Flags: --aot-harden=proof-checks
// A variable of a function that closures hold is stored in the turns of a loop inside another. What it holds in front of its first store is read by nobody: the check of that read stopped the program.
function wire(grid) {
  var out = [], handlers = [];
  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      var id = grid[r][c] / 2;
      out.push(id);
      handlers.push(function () { return id; });
    }
  }
  return { out: out, handlers: handlers };
}
var w = wire([[1, 2], [3]]);
console.log(w.out.join(), w.handlers.length, w.handlers[0]());
