// A method that is found through a proxy runs with the proxy as `this`: it stores through the proxy and hands the proxy back. The names that nobody declares stay as they are: the fault showed only beside them.
function show(value) {
  if (typeof value === "number")
    return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "bigint")
    return String(value) + "n";
  if (typeof value === "symbol")
    return value.toString();
  if (typeof value === "function")
    return "function " + value.name;
  if (typeof value !== "object" || value === null)
    return String(value);
  const parts = [];
  if (Array.isArray(value)) {
    const list = value;
    for (let i = 0;i < list.length; i++)
      parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries = Object.entries(value);
  for (const [key, member] of entries)
    parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}
function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

function logged(label, run) {
  log.length = 0;
  attempt(label, run);
  console.log("  traps: " + log.join(" "));
}
attempt("n19-super-call-through-a-proxy", () => {
  class Base { who() { return this; } }
  class Chain extends Base { who() { return super.who(); } }
  const chain = new Chain; const wrapped = new Proxy(chain, {});
  return [wrapped.who() === wrapped, chain.who() === chain];
});
attempt("sorted by identity in a list", () => [proxy, target, second].map((item) => [target, proxy, second].indexOf(item)));
