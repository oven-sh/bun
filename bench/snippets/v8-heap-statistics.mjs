// @runtime node, bun
import v8 from "node:v8";
import { bench, run } from "../runner.mjs";

// The cost of a call must not follow the size of the heap. The names start with the count of retained objects.
const sizes = [0, 250_000, 500_000, 1_000_000, 2_000_000];
const retained = [];
function retain(count) {
  retained.length = 0;
  for (let i = 0; i < count; i++) retained.push({ i });
}

bench("$retained: getHeapStatistics()", function* (state) {
  retain(state.get("retained"));
  yield () => v8.getHeapStatistics();
}).args("retained", sizes);

bench("$retained: getHeapSpaceStatistics()", function* (state) {
  retain(state.get("retained"));
  yield () => v8.getHeapSpaceStatistics();
}).args("retained", sizes);

bench("$retained: process.memoryUsage()", function* (state) {
  retain(state.get("retained"));
  yield () => process.memoryUsage();
}).args("retained", sizes);

await run();
