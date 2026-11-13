// Object.defineProperty on what is no object: one frame of defineProperty in the stack, whatever the descriptor.
const show = error => error.message + " | " + String(error.stack).split("\n").slice(1).map(line => line.trim().replace(/\(?[^\s(]*defined-on-primitives\.cjs/, "F")).slice(0, 3).join(" | ");
const sites = error => error.stack;
const ways = {
  literal(target) { Object.defineProperty(target, "a", {}); },
  value(target) { Object.defineProperty(target, "a", { value: 1 }); },
  getter(target) { Object.defineProperty(target, "a", { get() { return 1; } }); },
  unknown(target, descriptor) { Object.defineProperty(target, "a", descriptor); },
  key(target, descriptor) { Object.defineProperty(target, descriptor, descriptor); },
  symbol(target) { Object.defineProperty(target, Symbol.iterator, { value: 1, enumerable: true }); },
  called(target, descriptor) { Object.defineProperty.call(null, target, "a", descriptor); },
  applied(target, descriptor) { Object.defineProperty.apply(Object, [target, "a", descriptor]); },
  passed(target, descriptor) { [target].forEach(each => { Object.defineProperty(each, "a", descriptor); }); },
  result(target, descriptor) { const defined = Object.defineProperty(target, "a", descriptor); return defined; },
};
const targets = [1, "text", true, undefined, null, Symbol.iterator, 10n];
for (const [name, way] of Object.entries(ways)) {
  for (const target of targets) {
    for (const descriptor of [{}, { value: 1 }, { get: 1 }, 5, { get value() { throw new Error("read"); } }]) {
      try { way(target, descriptor); console.log(name, "fine"); } catch (error) { console.log(name, String(target), show(error)); }
    }
  }
}
for (const limit of [0, 1, 2]) {
  Error.stackTraceLimit = limit;
  try { ways.unknown(1, {}); } catch (error) { console.log(limit, show(error)); }
}
Error.stackTraceLimit = 10;
Error.prepareStackTrace = (error, calls) => calls.map(call => call.getFunctionName()).slice(0, 2).join(",");
for (const name of ["literal", "unknown", "symbol"]) try { ways[name](1, {}); } catch (error) { console.log(name, sites(error)); }
