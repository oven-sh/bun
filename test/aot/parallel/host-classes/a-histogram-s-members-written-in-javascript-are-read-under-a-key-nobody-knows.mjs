// The members of a histogram that are written in JavaScript are in an executable that reads them under a key the compiler does not know.
// Alone: whether the three functions are in the executable depends on what else it holds
import { createHistogram } from "node:perf_hooks";
const h = createHistogram();
h.record(5);
h.record(9);
const key = name => process.argv[5] ?? name;
console.log(h[key("percentilesAt")]([50, 100]));
console.log(h[key("percentileCI")](50));
console.log(Object.keys(await h[key("qrde")]()));
for (const name of ["percentilesAt", "percentileCI", "qrde"]) {
  try {
    h[key(name)].call({});
  } catch (error) {
    console.log(name, error.name, error.code);
  }
}
