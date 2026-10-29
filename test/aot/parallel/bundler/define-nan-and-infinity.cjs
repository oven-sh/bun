// `NaN` and `Infinity` as --define values are the numbers. A read has the number, also beside a direct eval, and a store leaves the defined name as written.
// Flags: --define=LIMIT=Infinity --define=settings.limit=Infinity --define=MISSING=NaN
// Reference: bun build --compile
globalThis.settings = { limit: 1 };
console.log(
  LIMIT,
  settings.limit,
  settings["limit"],
  MISSING,
  typeof LIMIT,
  typeof MISSING,
  1 / LIMIT,
  MISSING === MISSING,
);
globalThis.LIMIT = globalThis.MISSING = 0;
settings.limit = 10;
LIMIT = 20;
MISSING = 30;
LIMIT += 1;
MISSING++;
console.log(Reflect.get(settings, "limit"), globalThis.LIMIT, globalThis.MISSING, LIMIT, MISSING);
function besideEval(text) {
  eval(text);
  return [LIMIT, MISSING, settings.limit];
}
console.log(besideEval("var unrelated = 1"));
module.exports = {};
