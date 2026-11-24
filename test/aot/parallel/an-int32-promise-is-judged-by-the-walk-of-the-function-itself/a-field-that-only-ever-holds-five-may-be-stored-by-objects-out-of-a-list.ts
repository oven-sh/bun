// The same where the receivers come out of a list.
import type { int32 } from "bun";
class Meter {
  count: int32 = 0;
  limit: number = 5;
  take(): void {
    this.count = this.limit;
  }
}
const meters = [new Meter(), new Meter()];
for (const meter of meters) meter.take();
console.log(meters[0].count + meters[1].count);
