// Flags: --aot-harden=proof-checks
// A variable of a function that closures hold is stored in the turns of a loop, in its head. What it holds in front of its first store is read by nobody: the check of that read stopped the program.
function scan(lines) {
  var found = [], readers = [];
  for (var i = 0; i < lines.length; i++) {
    var from = 0, at;
    while ((at = lines[i].indexOf("b", from)) >= 0) { found.push(at); from = at + 1; readers.push(function () { return at; }); }
  }
  return { found: found, readers: readers };
}
var w = scan(["abcb", "bb", "none"]);
console.log(w.found.join(), w.readers.length, w.readers[0]());
