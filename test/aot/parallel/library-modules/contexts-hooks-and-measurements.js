// node:async_hooks, node:perf_hooks and node:diagnostics_channel: a store that follows promises, timers, ticks and emitters; snapshot, bind and exit; AsyncResource; marks, measures, an observer, timerify and a histogram; channels with subscribers and a tracing channel.
import { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId } from "node:async_hooks";
import { performance, PerformanceObserver, createHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import diagnostics from "node:diagnostics_channel";
import { EventEmitter } from "node:events";

const storage = new AsyncLocalStorage();
const seen = [];
await storage.run({ id: 1 }, async () => {
  seen.push("sync " + storage.getStore().id);
  await null;
  seen.push("await " + storage.getStore().id);
  await new Promise(resolve => setTimeout(() => { seen.push("timeout " + storage.getStore().id); resolve(); }, 1));
  await new Promise(resolve => process.nextTick(() => { seen.push("tick " + storage.getStore().id); resolve(); }));
  await new Promise(resolve => setImmediate(() => { seen.push("immediate " + storage.getStore().id); resolve(); }));
  await storage.run({ id: 2 }, async () => { await null; seen.push("nested " + storage.getStore().id); });
  seen.push("after nested " + storage.getStore().id);
  storage.exit(() => seen.push("exit " + storage.getStore()));
});
console.log(seen.join(", "), storage.getStore());
const snapshot = storage.run("snap", () => AsyncLocalStorage.snapshot());
const bound = storage.run("bound", () => AsyncLocalStorage.bind(() => storage.getStore()));
console.log(snapshot(() => storage.getStore()), bound());
storage.enterWith("entered");
console.log(storage.getStore());
storage.disable();
console.log(storage.getStore());
const resource = storage.run("resource", () => new AsyncResource("Custom"));
console.log(resource.runInAsyncScope(() => storage.getStore()), typeof resource.asyncId(), typeof executionAsyncId(), typeof triggerAsyncId());
const emitter = new EventEmitter();
storage.run("at the listener", () => emitter.on("x", () => console.log("emitter:", storage.getStore())));
storage.run("at the emit", () => emitter.emit("x"));

const entries = [];
const delivered = Promise.withResolvers();
const observer = new PerformanceObserver(list => delivered.resolve(entries.push(...list.getEntries().map(entry => entry.entryType + ":" + entry.name))));
observer.observe({ entryTypes: ["mark", "measure"] });
performance.mark("start");
performance.mark("end", { detail: { note: 1 } });
const measure = performance.measure("span", "start", "end");
// The interval wakes an event loop that sleeps while the delivery is queued.
const interval = setInterval(() => {}, 1);
await delivered.promise;
clearInterval(interval);
observer.disconnect();
console.log(entries.sort().join(), measure.duration >= 0, performance.getEntriesByName("end")[0].detail.note, performance.getEntriesByType("mark").length, typeof performance.now(), performance.timeOrigin > 0);
performance.clearMarks();
console.log(performance.getEntriesByType("mark").length, performance.timerify(function add(a, b) { return a + b; })(1, 2), typeof performance.eventLoopUtilization().utilization, performance === globalThis.performance);
const histogram = createHistogram();
for (const value of [1, 2, 3, 4, 100]) histogram.record(value);
console.log(histogram.count, histogram.min, histogram.max, histogram.percentile(50), typeof histogram.mean, typeof monitorEventLoopDelay);

const channel = diagnostics.channel("my-channel");
const heard = [];
const listener = (message, name) => heard.push(name + " " + message.n);
console.log(channel.hasSubscribers, diagnostics.hasSubscribers("my-channel"));
diagnostics.subscribe("my-channel", listener);
channel.publish({ n: 1 });
console.log(channel.hasSubscribers, diagnostics.unsubscribe("my-channel", listener), channel.hasSubscribers);
channel.publish({ n: 2 });
console.log(heard.join(), channel.name, diagnostics.channel("my-channel") === channel);
const tracing = diagnostics.tracingChannel("work");
const steps = [];
tracing.subscribe({ start: () => steps.push("start"), end: () => steps.push("end"), asyncStart: () => steps.push("asyncStart"), asyncEnd: () => steps.push("asyncEnd"), error: () => steps.push("error") });
console.log(tracing.traceSync(() => "traced", {}), await tracing.tracePromise(async () => "promised", {}), steps.join());
