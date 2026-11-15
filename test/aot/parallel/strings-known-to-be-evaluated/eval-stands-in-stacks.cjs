// `eval` has a frame between a script that the build knows and who asked for it.
const names = error => error.stack.split("\n").slice(1).map(line => line.trim().replace(/ \(.*/, "").replace(/(at )?\S*eval-stands-in-stacks.*/, "file")).slice(0, 7).join(" | ");
globalThis.names = names;
globalThis.make = () => names(new Error("made"));
const evaluate = eval;
const ways = {
  indirect() { const made = (0, eval)("make()"); return made; },
  renamed() { const made = evaluate("make() + ''"); return made; },
  member() { const made = globalThis.eval("(function evaluated() { return make(); })()"); return made; },
  direct() { const made = eval("make() + 1"); return made; },
  nested() { const made = (0, eval)("(0, eval)('make() + 2') + 3"); return made; },
  returned() { const inner = (0, eval)("(function later() { return make() + 4; })"); return inner(); },
  arrow: () => { const made = (0, eval)("[5].map(() => make())[0]"); return made; },
  thrown() { try { (0, eval)("throw new Error('thrown')"); } catch (error) { return names(error); } },
  operator() { try { (0, eval)("null.x"); } catch (error) { return names(error); } },
  caught() { const made = (0, eval)("try { undefinedName } catch (error) { names(error) }"); return made; },
  looped() { let made; for (let turn = 0; turn < 30; turn++) made = (0, eval)("make() + 6"); return made; },
};
for (const [name, way] of Object.entries(ways)) console.log(name, way());
for (const limit of [0, 1, 2, 3]) {
  Error.stackTraceLimit = limit;
  try { (0, eval)("throw new Error('limit')"); } catch (error) { console.log(limit, String(error.stack).split("\n").slice(1).map(line => line.trim().split(" (")[0].replace(/\S*eval-stands.*/, "file")).join(" | ")); }
}
Error.stackTraceLimit = 10;
Error.prepareStackTrace = (error, sites) => sites.slice(0, 4).map(site => site.getFunctionName()).join(",");
for (const name of ["thrown", "operator"]) { let text; try { (0, eval)("throw new Error('prepared')"); } catch (error) { text = error.stack; } console.log(name, text); }
class Base { run() { const made = (0, eval)("(() => { try { make.call(undefined, 7); throw new TypeError('own'); } catch (error) { return error.stack; } })()"); return [made, 1].join(); } }
console.log(new Base().run());
Error.prepareStackTrace = (error, sites) => sites.slice(0, 3).map(site => site.getFunctionName() + ":" + site.getLineNumber()).join(",");
function strict() { "use strict"; let made = eval("make()"); made += eval("make() + 8"); return made; }
console.log(strict());
function placed() {
  const made =
    (0, eval)("make()");
  return [made].join();
}
console.log(placed());
