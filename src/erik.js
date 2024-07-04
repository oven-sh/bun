// import { performance, createHistogram } from "node:perf_hooks";
// cannot use import statement outside a module, so we do:
const { performance, createHistogram } = require("perf_hooks");

const fn = () => {
  console.log("hello world");
};

let h = createHistogram();
h.record(100, 1);
h.record(200, 100);
h.record(1000, 1000);
h.record(2000, 1000);
h.record(3000, 1000);
h.record(5000, 1000);
h.record(1000000, 1);
console.log("after", h);

let otherH = createHistogram();
otherH.record(1, 300);
h.add(otherH);

console.log("after add", h);

h.reset();

let wrapped = performance.timerify(fn, { histogram: h });
for (let i = 0; i < 1000; i++) {
  wrapped();
}
console.log(h);

// // wrapped(400);
// console.log(h);

// h.percentiles.forEach((value, key) => {
//   console.log(key, value);
// });

// const { performance, PerformanceObserver } = require("node:perf_hooks");

// function someFunction() {
//   console.log("hello world");
// }

// const wrapped = performance.timerify(someFunction);

// const obs = new PerformanceObserver(list => {
//   for (const entry of list.getEntries()) {
//     console.log(entry);
//   }

//   performance.clearMarks();
//   performance.clearMeasures();
//   obs.disconnect();
// });
// obs.observe({ entryTypes: ["function"] });

// // A performance timeline entry will be created
// wrapped();
// wrapped();
// wrapped();
// wrapped();

// erik todo
// histogram

// const util = require("util");

// function getAllMethods(obj) {
//   let methods = new Set();
//   while ((obj = Reflect.getPrototypeOf(obj))) {
//     let keys = Reflect.ownKeys(obj);
//     keys.forEach(k => methods.add(k));
//   }
//   return methods;
// }

// function printObjectWithMethods(obj) {
//   console.log(
//     util.inspect(obj, {
//       showHidden: true,
//       depth: null,
//       colors: true,
//     }),
//   );

//   const methods = getAllMethods(obj);
//   console.log("Methods:", [...methods]);
// }

// // Example usage
// const exampleObj = {
//   a: 1,
//   b: "string",
//   c: [1, 2, 3],
//   method1: function () {},
//   method2: () => {},
// };

// printObjectWithMethods(h);
