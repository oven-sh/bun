// The text that an indirect eval is given, known when the program is built: its frame is one of eval code for a call site, in a stack and where an error is printed.
const withoutFolders = text => String(text).replace(/[^\s(|]*[\\/]([^\\/\s:]+:\d+:\d+)/g, "$1");
const top = text => withoutFolders(text).split("\n").slice(0, 4).join("\n");
function sitesOf(run) {
  const kept = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) =>
    sites
      .slice(0, 4)
      .map(site =>
        [
          site.getFunctionName(),
          site.getMethodName(),
          site.getTypeName(),
          site.isEval(),
          site.isToplevel(),
          site.isNative(),
          site.isConstructor(),
          site.isAsync(),
          site.getEvalOrigin(),
          String(site),
        ].join("|"),
      )
      .join("\n  ");
  try {
    return withoutFolders(run());
  } finally {
    Error.prepareStackTrace = kept;
  }
}
console.log(sitesOf(() => (0, eval)("new Error('the text itself').stack")));
console.log(sitesOf(() => (0, eval)("(() => new Error('an arrow in the text').stack)()")));
console.log(sitesOf(() => (0, eval)("(function named() { return new Error('a function in the text').stack; })()")));
console.log(
  sitesOf(() => (0, eval)("(function () { return new Error('a function without a name in the text').stack; })()")),
);
console.log(sitesOf(() => new Function("return new Error('the body of a function').stack")()));
console.log(sitesOf(() => globalThis.eval("new Error('eval of the global object').stack")));
console.log(top((0, eval)("new Error('as a text').stack")));
console.log(top((0, eval)("(function named() { return new Error('as a text, in a function').stack; })()")));
const printed = text =>
  withoutFolders(text)
    .split("\n")
    .filter(line => /^\s+at /.test(line))
    .slice(0, 2)
    .join("\n");
console.log(printed(Bun.inspect((0, eval)("new Error('printed')"))));
console.log(printed(Bun.inspect((0, eval)("(function named() { return new Error('printed, in a function'); })()"))));
const made = ["new Error('made", "at run time').stack"].join(" ");
console.log(sitesOf(() => (0, eval)(made)));
