// The program takes Performance from the global object before it reads the clock for the first time. performance still finds now on its prototype.
const taken = Reflect.deleteProperty(globalThis, "Performance");
console.log(taken, typeof Performance, typeof performance.now(), performance.now() > 0);
