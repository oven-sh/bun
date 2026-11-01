// A proxy of a class and an instance of that class lie in pairs that a loop takes apart. The program is compiled with the few built-ins that it runs, not with all of them.
// STATISTIC: ImageFunctionsEmitted <= 30
class Plain {}
const values = [
  ["proxy", new Proxy(Plain, {})],
  ["instance", new Plain()],
];
for (const [name, value] of values) console.log(name, typeof value === "function");
