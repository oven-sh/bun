// `callback.call(receiver, leaf, count++)` in an inner function that captures the parameter `callback`, in a program in which text that nobody has seen may run. The functions that are handed in
// are called by nothing else: a compiler that gives an unknown callee of `o.m(..)` only some of the receivers takes them for never called and leaves them out.
import walk from "./walk.cjs";
if (process.argv.length > 99) {
  globalThis.somethingNobodyKnows(walk);
  new Function(process.argv[3])();
}
const list = walk.leaves.toList([1, "two", [3, process.argv.length > 99 ? 5 : 4]]);
console.log(list.join(), walk.leaves.count(list), walk.leaves.map(list, function (leaf, index) { return this.prefix + index + leaf; }, { prefix: "#" }).join());
