// `func.call(context, ..)` in children.cjs: the function that runs is the receiver of the call. The object that holds `map` is handed to code that nobody compiles,
// so `func` may be anything, and so may what is found on it under `call`. The functions that this file hands over run all the same.
import React from "./children.cjs";
if (process.argv.length > 99) {
  process.stdout.write(process.argv[2]);
  globalThis.somethingNobodyKnows(React);
  new Function(process.argv[3])();
}
const list = React.Children.toArray([1, "two", [3, process.argv.length]]);
console.log(list.join(","), React.Children.count(list));
let seen = "";
React.Children.forEach(list, function (child, index) {
  seen += index + ":" + child + (this === undefined ? "" : this.mark) + " ";
}, { mark: "!" });
console.log(seen);
console.log(React.Children.map(list, child => child + "?").join(","));
