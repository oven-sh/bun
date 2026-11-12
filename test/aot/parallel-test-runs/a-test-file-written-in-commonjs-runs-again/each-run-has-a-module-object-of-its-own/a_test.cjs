const { test, beforeAll } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
let count = 0;
const tag = strings => strings,
  made = () => tag`x`;
class Kept {}
globalThis.first ??= { module, strings: made(), Kept };
module.exports.mark = run;
beforeAll(() => {
  count++;
});
test("t", () => {
  const { first } = globalThis;
  console.log(
    "SAID",
    run,
    count,
    module.exports.mark,
    (module === first.module) === (run === 1),
    (made() === first.strings) === (run === 1),
    (Kept === first.Kept) === (run === 1),
    require.main === module,
    require.cache[__filename] === module,
  );
});
