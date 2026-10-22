// The host makes these at their first read and stores them on the object, long after the program has started.
console.log(typeof console.Console, typeof console._stdout, typeof console._stderr, console._stdout === process.stdout);
console.log(Object.getOwnPropertyDescriptor(console, "_stdout").value === process.stdout, Object.getOwnPropertyDescriptor(console, "Console").value === console.Console);
const { performance } = require("node:perf_hooks");
console.log(typeof performance.timeOrigin, performance === globalThis.performance, typeof performance.eventLoopUtilization, typeof performance.nodeTiming);
console.log(typeof navigator.hardwareConcurrency, typeof navigator.userAgent, Object.keys(Object.getOwnPropertyDescriptors(navigator)).sort().join());
console.log(process.stdout === process.stdout, typeof process.stdout.fd, process.stdin === process.stdin, typeof process.binding, typeof process.mainModule, process.argv0.length > 0);
console.log(typeof process.report.getReport, typeof process.allowedNodeEnvironmentFlags, Object.getOwnPropertyDescriptor(process, "stdout").get === undefined);
