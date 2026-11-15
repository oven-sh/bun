// The same with variables of the file.
import type { int32 } from "bun";
const limit: number = 5;
let count: int32 = 0;
function take(): void {
  count = limit;
}
take();
console.log(count);
