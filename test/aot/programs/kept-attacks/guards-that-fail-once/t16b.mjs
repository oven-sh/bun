// Guards that fail once, one probe of many. It prints what plain Bun prints.
class Registry {
  static make() { return "declared"; }
}
class Below extends Registry {}
function Legacy() {}
Legacy.prototype.run = function () { return 1; };
const key = process.argv[2] ?? "helper";
const first = () => "first";
const second = () => "second";
Registry[key] = first;
Legacy[key] = first;
function setInClass(f) { Registry.helper = f; }
function setInFunction(f) { Legacy.helper = f; }
function callAll() { return Registry.helper() + " " + Below.helper() + " " + Legacy.helper(); }
function readAll() { return (Registry.helper === Below.helper) + " " + Registry.helper.name + " " + Below.helper.name + " " + Legacy.helper.name; }
const seen = new Map();
for (let round = 0; round < 3000; round++) {
  const f = round % 3 === 0 ? second : first;
  setInClass(f);
  setInFunction(f);
  const line = (round % 3 === 0) + " " + callAll() + " | " + readAll();
  seen.set(line, (seen.get(line) ?? 0) + 1);
}
for (const [line, count] of seen) console.log(count, line);
Below.helper = () => "own";
setInClass(first);
console.log(callAll(), "|", readAll());
delete Below.helper;
setInClass(second);
console.log(callAll(), "|", readAll());
Object.defineProperty(Registry, "helper", { get() { return () => "getter"; }, set(v) { console.log("setter", v.name); }, configurable: true });
setInClass(first);
console.log(callAll());
Object.defineProperty(Registry, "helper", { value: second, writable: false, configurable: true });
try { setInClass(first); console.log("stored"); } catch (error) { console.log(error.constructor.name); }
console.log(callAll());
