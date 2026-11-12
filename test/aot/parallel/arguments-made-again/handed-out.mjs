const unseen = (0, eval)("(x) => x");
const sink = unseen({ apply(self, list) { return list.length + ":" + Array.prototype.join.call(list, ","); } });
function wrap(first, ...others) {
  unseen(others).push("by unseen code");
  return sink.apply(null, arguments);
}
let last = "";
for (let i = 0; i < 300; i++) last = wrap("a", "b", "c");
console.log(last);
