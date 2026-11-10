// The build shows that limit only ever holds 5, so the store keeps the promise, in the method itself and in the copy of its one call.
import type { int32 } from "bun";
class Meter {
  count: int32 = 0;
  limit: number = 5;
  take(): void {
    this.count = this.limit;
  }
}
const meter = new Meter();
meter.take();
console.log(meter.count);
