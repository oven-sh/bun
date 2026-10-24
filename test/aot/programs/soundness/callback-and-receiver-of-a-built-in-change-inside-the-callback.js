// The callback and the receiver of a built-in change inside that callback.
function main() {
  let callback = (m) => { callback = (n) => ({ toString() { return "[" + n + "]"; } }); return "1"; };
  let text = "aaa";
  for (let i = 0; i < 3; i++) text = text.replace("a", callback);
  console.log(text);
  let receiver = "xyz";
  const lengths = [];
  function swap(m) { receiver = { toString() { return "object text"; } }; return m; }
  for (let i = 0; i < 2; i++) lengths.push(String.prototype.replace.call(receiver, "x", swap).length);
  console.log(lengths.join());
}
main();
