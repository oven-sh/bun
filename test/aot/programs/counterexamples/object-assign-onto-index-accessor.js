// `Object.assign` stores to an indexed accessor of the target through its setter.
const t = Object.assign({ get 1() { return 5; }, set 1(v) {} }, { get b() { return 1; } }, { 1: "x" });
console.log(t[1]);
