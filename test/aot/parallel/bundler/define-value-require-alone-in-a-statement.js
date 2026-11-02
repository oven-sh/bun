// A statement that is only a name whose `--define` value is `require` keeps that name, as `require;` does there: a `.js` file without `import` and `export` is then a CommonJS file, and `this` of a plain call is the global object. `bun run` leaves the statement out with its name and runs an ES module. Plain Bun prints another output.
// Flags: --define R=require
R;
console.log(
  (function () {
    return typeof this;
  })(),
);
/* Output:
object
*/
