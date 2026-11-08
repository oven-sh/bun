// `symbols` answers the one ordinary object that native code has made for the library, with a function under each name.
import { JSCallback, linkSymbols } from "bun:ffi";

const halved = new JSCallback(value => value / 2, { args: ["f64"], returns: "f64" });
const negated = new JSCallback(value => !value, { args: ["bool"], returns: "bool" });
const linked = linkSymbols({
  halve: { ptr: halved.ptr, args: ["f64"], returns: "f64" },
  negate: { ptr: negated.ptr, args: ["bool"], returns: "bool" },
});
const { symbols } = linked;
console.log(Object.keys(symbols).join(), String(symbols === linked.symbols), typeof symbols);
console.log(
  String(Object.getPrototypeOf(symbols) === Object.prototype),
  String("halve" in symbols),
  String("close" in symbols),
);
for (const name in symbols) console.log(name, typeof symbols[name], String(symbols[name].length));
console.log(String(symbols.halve(9)), String(symbols.negate(false)), String(linked.symbols["halve"](1)));
symbols.added = 1;
console.log(Object.keys(linked.symbols).join());
linked.close();
halved.close();
negated.close();
