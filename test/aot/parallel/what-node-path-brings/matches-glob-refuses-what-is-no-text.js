// matchesGlob() tests the path, then the pattern, and says what internal/validators would say. The pattern is not tested where it is the one of the call before.
const path = require("node:path");
function ask(...operands) {
  try {
    return path.matchesGlob(...operands);
  } catch (error) {
    return [error.name, error.code, error.message].join(" | ");
  }
}
console.log(ask("a/b.txt", "a/*.txt"), ask("a/b.txt", "a/*.txt"), ask("a/b.md", "a/*.txt"), path.win32.matchesGlob("a\\b.txt", "a/*.txt"));
for (const odd of [5, undefined, null, {}, Symbol("made"), new String("a/b.txt"), () => {}]) console.log(ask(odd, "a/*.txt"));
for (const odd of [5, undefined, null, {}, Symbol("made"), new String("a/*.txt")]) console.log(ask("a/b.txt", odd));
console.log(ask(5, 5), path.matchesGlob.name, path.matchesGlob.length, path.posix.matchesGlob === path.matchesGlob);
