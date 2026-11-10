// RUN: link
// CHECK: function {{*}}name="byName" {{*}}parameters=[{type=undefined|null|string flags=[IsExpected]}]
// CHECK: function {{*}}name="byPattern" {{*}}parameters=[{type=undefined|null|string flags=[IsExpected]}]
// CHECK: function {{*}}name="byText" {{*}}parameters=[{type=undefined|null|string flags=[IsExpected]}]

// Neither literal has every name, so each keeps its own. A name that only one of them has still reads as what that one holds, or undefined.
function verify(text) {
  if (text.length > 3) return { ok: true, mark: "m" + text };
  return { ok: false, reason: "short" };
}
function byName(value) {
  return String(value) + 1;
}
function byPattern(value) {
  return String(value) + 2;
}
function byText(value) {
  return String(value) + 3;
}
function run(text) {
  const check = verify(text);
  const { mark } = verify(text);
  return byName(check.mark) + byPattern(mark) + byText(check["mark"]);
}
console.log(run("abcd"), run("a"));

// What is stored under such a name is held to nothing: the list that `inner` began as is empty, and this one is not.
// CHECK: NewArray {{*}} contents=anything
function define(word) {
  const ring = { parts: [{ tag: "t", begin: word }, { begin: /a/, end: /b/, inner: [] }] };
  ring.parts[1].inner = [ring];
  return ring;
}
console.log(define("w").parts[1].inner.length);
