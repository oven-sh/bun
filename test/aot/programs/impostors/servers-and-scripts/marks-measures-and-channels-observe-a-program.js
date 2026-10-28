import diagnostics from "node:diagnostics_channel";
import { createRequire } from "node:module";
import { PerformanceObserver, monitorEventLoopDelay, performance as nodePerformance } from "node:perf_hooks";

console.log(nodePerformance === performance, typeof performance.timeOrigin, performance.now() > 0);
performance.mark("start", { detail: { step: 1 } });
for (let i = 0, sum = 0; i < 1e5; i++) sum += i;
performance.mark("end");
const measure = performance.measure("work", "start", "end");
console.log(measure.name, measure.entryType, measure.duration >= 0, performance.getEntriesByName("start")[0].detail, performance.getEntriesByType("mark").map(entry => entry.name), performance.getEntries().length);
performance.clearMarks("start");
console.log(performance.getEntriesByType("mark").length);
performance.clearMarks();
performance.clearMeasures();
try {
  performance.measure("bad", "no-such-mark");
} catch (error) {
  console.log(error.name);
}
const observed = await new Promise(resolve => {
  const observer = new PerformanceObserver((list, self) => {
    self.disconnect();
    resolve(list.getEntries().map(entry => entry.entryType + ":" + entry.name));
  });
  observer.observe({ entryTypes: ["mark", "measure"] });
  performance.mark("seen");
});
console.log(observed, PerformanceObserver.supportedEntryTypes.includes("mark"), typeof performance.timerify(() => 1)(), typeof performance.eventLoopUtilization?.().utilization, typeof monitorEventLoopDelay);

const channel = diagnostics.channel("app:request");
const heard = [];
const listener = (message, name) => heard.push(name + " " + message.url);
console.log(channel.hasSubscribers, diagnostics.hasSubscribers("app:request"));
diagnostics.subscribe("app:request", listener);
channel.publish({ url: "/one" });
console.log(channel.hasSubscribers, channel.name, diagnostics.unsubscribe("app:request", listener), diagnostics.unsubscribe("app:request", listener));
channel.publish({ url: "/two" });
console.log(heard);
const tracing = diagnostics.tracingChannel("app:job");
const steps = [];
tracing.subscribe({ start: message => steps.push("start " + message.id), end: message => steps.push("end " + message.result), error: message => steps.push("error " + message.error.message) });
console.log(tracing.traceSync(id => id * 2, { id: 4 }, null, 4), steps);

const require = createRequire(import.meta.url);
console.log(require("node:path").sep, typeof require.resolve, require("node:os") === require("os"), typeof require.cache, require("node:module").builtinModules.includes("fs"), require("node:module").isBuiltin("node:http"), require("node:module").isBuiltin("left-pad"));
try {
  require("./no-such-file-here.js");
} catch (error) {
  console.log(error.code ?? error.name);
}
