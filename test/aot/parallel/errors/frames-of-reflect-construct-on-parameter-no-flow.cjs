// Flags: --aot-disable=flow-results
// A call that is written `Reflect.construct(..)` lists no frame of that function, whatever `Reflect` names there, and lists the function that it finds in its place.
function Thrower() { throw new Error("thrown"); }
function listSites(run) {
  Error.prepareStackTrace = (error, sites) => sites.slice(0, 4).map(site => site.getFunctionName() + " " + site.getLineNumber() + ":" + site.getColumnNumber()).join(" < ");
  try { run(); } catch (error) { return error.stack; } finally { Error.prepareStackTrace = undefined; }
}
const cases = {
  parameterNamedReflect(Reflect = globalThis.Reflect) { const made = Reflect.construct(Thrower, []); return made; },
  parameterGiven(Reflect) { const made = Reflect.construct(Thrower, []); return made; },
  otherName(R = globalThis.Reflect) { const made = R.construct(Thrower, []); return made; },
  notTheBuiltin(Reflect = { construct(f) { const made = new f(); return made; } }) { const made = Reflect.construct(Thrower, []); return made; },
  written() { const made = Reflect.construct(Thrower, []); return made; },
};
for (const name of Object.keys(cases)) console.log(name, listSites(() => { const made = cases[name](name === "parameterGiven" ? Reflect : undefined); return made; }));
