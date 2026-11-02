// The text of a data: URL does not parse, and the loader rejects the import with an AggregateError. Its stack begins with the function that called import().
const show = where => error =>
  console.log(
    where + ":",
    error.name,
    typeof error.stack,
    String(error.stack)
      .split("\n")
      .slice(1)
      .map(line => line.trim().replace(/\(?[^ ()]*[\\/]([^\\/ ()]+)\)?$/, "$1"))
      .join(" < "),
    error.line,
    error.column,
    Object.getOwnPropertyNames(error).sort().join(),
  );
function inner() {
  return import("data:text/javascript,let let = 1 +");
}
function outer() {
  const promise = inner();
  return promise;
}
await import("data:text/javascript,let let = 2 +").catch(show("at the top"));
await outer().catch(show("in two functions"));
await Promise.resolve()
  .then(() => import("data:text/javascript,let let = 3 +"))
  .catch(show("in a job"));
await new Promise(resolve => setTimeout(resolve, 1)).then(outer).catch(show("behind a timer"));
try {
  await inner();
} catch (error) {
  show("awaited")(error);
}
