// The length of `new String(value)` is the length of the string that the value is converted to.
// STATISTIC: StringObjectsOfConvertedValues >= 4
// STATISTIC: StringObjectsReadForLengthAlone >= 2
const log = [];
function two(n) { return new String(n).length == 1 ? "0" + n : n; }
function three(n) { var s = new String(n); return s.length; }
function pad(value, size, ch) {
  var result = new String(value);
  if (ch == null) ch = " ";
  while (result.length < size) result = ch + result;
  return result;
}
function kinds(v) { try { return new String(v).length; } catch (e) { return e.name + " " + e.message; } }
for (const n of [0, 7, 12, -3, 1.5, 1e21, NaN, "text", "", null, undefined, true, 10n, [1, 2], {}, { toString() { log.push("converted"); return "four"; } }, { toString() { return {}; }, valueOf() { return 12; } }, Symbol("s"), new String("object"), new Date(NaN)]) {
  log.push(kinds(n));
  if (typeof n !== "symbol") log.push(String(two(n)).length, three(n));
}
for (const [v, size, ch] of [[5, 2, "0"], [12, 2, "0"], ["x", 4, undefined], [null, 6, "-"], ["long", 2, "0"], ["é", 3, "ü"]]) {
  const padded = pad(v, size, ch);
  log.push(typeof padded, padded.length, padded + "|", "|" + padded, padded + padded, padded == pad(v, size, ch), `${padded}`);
}
const own = new String("abc");
own.valueOf = () => "own";
log.push(own + "!", "!" + own, own.length, own < "b", own == "own");
own.toString = () => "other";
log.push(own + "!", `${own}`, own - 1, +own);
const primitive = new String("7");
log.push(primitive + 1, 1 + primitive, primitive - 1, primitive * 2, primitive < 8, primitive + primitive, primitive == 7, primitive == "7", primitive === "7");
primitive[Symbol.toPrimitive] = (hint) => hint;
log.push(primitive + 1, `${primitive}`, primitive - 1);
class Sub extends String { valueOf() { return "sub"; } get size() { return this.length; } }
log.push(new Sub("base") + "!", new Sub("base").length, new Sub("base").size);
const bare = Object.setPrototypeOf(new String("bare"), null);
try { log.push(bare.length, bare + "!"); } catch (e) { log.push(e.name); }
log.push(Object.keys(new String("ab")).join(), new String("ab")[1], "length" in new String("ab"), Object.getOwnPropertyDescriptor(new String("ab"), "length").value);
const changed = new String("abc");
try { "use strict"; changed.length = 9; } catch (e) { log.push(e.name); }
log.push(changed.length, delete changed.length, changed.length);
log.push(new String().length, new String().valueOf() === "", new String("a", "b").length);
console.log(log.join("\n"));
