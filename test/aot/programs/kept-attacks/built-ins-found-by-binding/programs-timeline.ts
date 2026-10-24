// Built ins found by binding: programs timeline. It prints what plain Bun prints.
console.log(Object.keys(performance).join(), Object.hasOwn(performance, "mark"), typeof performance.mark, performance.mark === Performance.prototype.mark);
console.log(Object.getPrototypeOf(performance) === Performance.prototype, Object.getPrototypeOf(Performance.prototype) === EventTarget.prototype);
console.log(typeof performance.now(), typeof performance.timeOrigin, performance.timeOrigin > 0, typeof (performance as any).timing);
const mark = performance.mark("first", { detail: { a: 1 } });
console.log(mark.name, mark.entryType, mark.detail.a, performance.getEntriesByName("first").length, performance.getEntriesByName("first")[0] === mark);
performance.mark("second");
const measure = performance.measure("between", "first", "second");
console.log(measure.name, measure.entryType, typeof measure.duration, performance.getEntries().length, performance.getEntriesByType("mark").length);
performance.clearMarks("first");
console.log(performance.getEntriesByType("mark").length);
performance.clearMarks();
performance.clearMeasures();
console.log(performance.getEntries().length, Object.keys(performance.toJSON()).sort().join());
let heard = 0;
const listener = (event: Event) => {
  heard += event.type.length;
};
performance.addEventListener("custom", listener);
console.log(performance.dispatchEvent(new Event("custom")), heard);
performance.removeEventListener("custom", listener);
console.log(performance.dispatchEvent(new Event("custom")), heard, performance.addEventListener === EventTarget.prototype.addEventListener);
console.log((performance as any).onresourcetimingbufferfull, performance.setResourceTimingBufferSize(10), performance.clearResourceTimings());
const target = new EventTarget();
target.addEventListener("ping", event => console.log("target heard " + event.type, event.target === target));
target.dispatchEvent(new Event("ping"));
const controller = new AbortController();
controller.signal.addEventListener("abort", () => console.log("aborted", controller.signal.aborted));
controller.abort();
class Mine extends EventTarget {
  count = 0;
}
const mine = new Mine();
mine.addEventListener("x", { handleEvent: () => void mine.count++ });
mine.dispatchEvent(new Event("x"));
console.log(mine.count);
try {
  (performance.mark as any).call({}, "x");
} catch (error) {
  console.log((error as Error).constructor.name);
}
try {
  new (Performance as any)();
} catch (error) {
  console.log((error as Error).constructor.name);
}
(performance as any).mark = () => "replaced";
console.log((performance as any).mark(), Object.hasOwn(performance, "mark"));
delete (performance as any).mark;
console.log(typeof performance.mark("third").startTime);
(performance as any).extra = 4;
console.log((performance as any).extra + 1, "extra" in performance);
