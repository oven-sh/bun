// The getters of Temporal and Intl: found under a common name in a value nobody knows, taken off their prototype object and called on an object of the program.
const names = ["sign", "days", "hours", "blank", "language", "region", "compare"];
function read(x, name) { try { const v = x[name]; return typeof v; } catch (error) { return error.constructor.name; } }
const own = { sign: 1, get days() { this.touched = true; return 2; } };
const out = [];
for (const name of names) out.push(read(own, name));
out.push(own.touched);
const holders = [globalThis.Temporal?.Duration?.prototype, Intl.Locale.prototype, Intl.Collator.prototype];
for (const holder of holders) {
  if (!holder) { out.push("none"); continue; }
  for (const name of Object.getOwnPropertyNames(holder)) {
    const getter = Object.getOwnPropertyDescriptor(holder, name).get;
    if (!getter) continue;
    try { getter.call(own); out.push("ran"); } catch (error) { out.push(error.constructor.name[0]); }
  }
}
let order = "";
const a = { toString() { order += "a"; own.sign = "changed"; return "x"; } }, b = { toString() { order += "b"; return "y"; } };
out.push(new Intl.Collator("en").compare(a, b), order, own.sign, new Intl.Locale("en-US").region);
if (globalThis.Temporal) out.push(new Temporal.Duration(0, 0, 0, -1).sign, JSON.parse('{"sign":3}').sign);
console.log(out.join());
