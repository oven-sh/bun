// replace and replaceAll refuse null and undefined where they replaced in strings before.
function replace(x) { return String.prototype.replace.call(x, "a", "q"); }
function replaceAll(x) { return String.prototype.replaceAll.call(x, "a", "q"); }
function replaceByPattern(x, pattern) { return String.prototype.replace.call(x, pattern, "q"); }
function replaceAllByPattern(x, pattern) { return String.prototype.replaceAll.call(x, pattern, "q"); }
for (const f of [replace, replaceAll, replaceByPattern, replaceAllByPattern]) {
  for (const value of [null, undefined]) {
    const messages = new Set();
    for (let i = 0; i < 30000; i++) {
      f("abc", /a/g);
      if (i % 4 === 0) try { f(value, /a/g); } catch (e) { messages.add(e.name + ": " + e.message); }
    }
    console.log(f.name, value, [...messages].join(" | "));
  }
}
