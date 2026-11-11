const said = [];
const list = Object.assign([10, 20, 30], { first: "f" });
const holder = { "0": "zero", "1": "one", length: "a length", constructor: "mine", toString: "text" };
for (let i = 0; i < 200; i++) {
  const a = list[i & 1 ? "0" : "1"], b = list[i & 1 ? "length" : "first"], c = holder[i & 1 ? "0" : "length"], d = holder[i & 1 ? "__proto__" : "constructor"], e = holder[i & 1 ? "toString" : "valueOf"];
  if (i < 2) said.push(a, b, c, d === Object.prototype, typeof e);
  holder[i & 1 ? "__proto__" : "extra"] = i & 1 ? null : i;
}
said.push(Object.getPrototypeOf(holder) === null, holder.extra, Object.keys(holder).join());
console.log(said.map(String).join(" "));
