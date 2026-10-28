// The callee of a call that takes a callback is no function: a TypeError, and no callback has run.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "");
const values = [undefined, null, 0, 1.5, "text", true, Symbol.iterator, 10n, {}, [], class C {}, new Proxy({}, {})];
const holder = { method: undefined };
let made = 0;
for (let i = 0; i < values.length; i++) {
  const callee = pick(values, i);
  try { callee(() => ++made); console.log(i, "returned"); } catch (e) { console.log(i, e.constructor.name, made); }
  holder.method = callee;
  try { holder.method(1, () => ++made); console.log(i, "returned"); } catch (e) { console.log(i, e.constructor.name, made); }
  try { pick(values, i)(1, 2, () => ++made); console.log(i, "returned"); } catch (e) { console.log(i, e.constructor.name, made); }
}
console.log(made);
