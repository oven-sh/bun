// What the call sites of Error.prepareStackTrace answer for the closures of one function, with and without a displayName of their own, in sloppy code.
function sitesOf(run) {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites;
  try {
    return run();
  } finally {
    Error.prepareStackTrace = before;
  }
}
function show(site) {
  return [site.getFunctionName(), site.isToplevel(), site.isEval(), site.isNative(), site.isConstructor(), site.isAsync(), site.getTypeName(), site.getMethodName()].join(" ");
}
function make(name) {
  const closure = function written() {
    return new Error("x").stack;
  };
  if (name) closure.displayName = name;
  return closure;
}
const holder = { method: make("held") };
for (const closure of [make("first"), make(""), make("second")]) {
  const sites = sitesOf(() => { const listed = closure(); return listed; });
  console.log(sites.slice(0, 2).map(show).join(" | "));
}
console.log(sitesOf(() => { const listed = holder.method(); return listed; }).slice(0, 2).map(show).join(" | "));
console.log(sitesOf(() => { const listed = new (make("constructed"))(); return typeof listed; }));
