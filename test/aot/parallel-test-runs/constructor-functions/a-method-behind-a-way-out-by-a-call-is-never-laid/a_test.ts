// `return note();` leaves the function in front of the store: the method is never laid.
import { test } from "bun:test";
function Gauge(this: any, v: number) {
  this.v = v;
}
function note() {
  return 0;
}
(function () {
  if (process.argv.length < 99) return note();
  Gauge.prototype.next = function () {
    return this.v + 1;
  };
})();
test("the method was never laid", () => {
  let out = "";
  for (let i = 0; i < 300; i++) out = typeof new (Gauge as any)(i).next;
  console.log("next is", out);
});
