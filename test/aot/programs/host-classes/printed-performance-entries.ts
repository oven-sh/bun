// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a PerformanceMark and a PerformanceMeasure. The times differ from run to run.
console.log(Bun.inspect(performance.mark("a")).split("\n").slice(0, 2).join(" "));
console.log(Bun.inspect(performance.measure("b")).split("\n").slice(0, 2).join(" "));
