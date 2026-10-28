// A data: URL that a statement imports as JSON is loaded once more by another file, with the type put together at run time: what that file's caller stores is read here.
import summed, { a as copied } from 'data:application/json,{"a":1,"inner":{"x":1}}' with { type: "json" };
import { loadWhatIsSummed } from "./another-file.mjs";
const sum = turns => {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total += summed.a + summed.inner.x;
  return total;
};
console.log(sum(100), copied);
const loaded = await loadWhatIsSummed();
loaded.default.a = 5;
loaded.default.inner.x = 0.25;
loaded.default.late = [1];
console.log(sum(100), copied, JSON.stringify(summed), loaded.default === summed);
