// An untyped package and a program of it (merges): patches of text in unified form read by expressions, applied, reversed, merged; conflicts marked
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
const base = 'a\nb\nc\nd\ne'; const edits = [base, 'a\nB\nc\nd\ne', 'a\nb\nc\nd\ne\nf', 'b\nc\nd\ne', 'a\nb\nX\nY\nd\ne', '', 'a\nb\nc\nD\ne', 'z\na\nb\nc\nd\ne']; edits.forEach((m, i) => edits.forEach((t, k) => { const r = lib.merge3(base, m, t); say(i, k, r.conflicts, JSON.stringify(r.text)); })); for (const bad of ['@@ -1 +1 @@\n', '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\nstray', '--- x\t2026\n+++ y\n@@ -0,0 +1,2 @@ note\n+p\n+q\n\\ No newline']) try { say(JSON.stringify(lib.parse(bad))); } catch (e) { say(e.message); }
