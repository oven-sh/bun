// A CommonJS file holds a direct eval in a function that never runs. The program prints every frame of the stacks that it reads at the top of the file and in a function, as call sites and as text.
function readSites() {
  const before = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites;
  const sites = new Error().stack;
  Error.prepareStackTrace = before;
  return sites;
}
function describe(sites) {
  return sites
    .map(site =>
      [
        JSON.stringify(site.getFunctionName()),
        site.isNative(),
        site.isToplevel(),
        String(site.getFileName()).replace(/^.*[\\/]/, ""),
        site.getLineNumber(),
        site.getColumnNumber(),
      ].join(" "),
    )
    .join(" | ");
}
function readText() {
  return new Error("in a function").stack.replace(/\(.*[\\/]/g, "(");
}
console.log(describe(readSites()));
console.log(new Error("at the top").stack.replace(/\(.*[\\/]/g, "("));
console.log(readText());
function never() {
  return eval("1");
}
