// import { performance, createHistogram } from "node:perf_hooks";
// cannot use import statement outside a module, so we do:
const { performance, createHistogram } = require("perf_hooks");

const fn = () => {
  console.log("hello world");
};

let h = createHistogram();
console.log("before", h);

let wrapped = performance.timerify(fn, { histogram: h });
wrapped();
console.log("after", h);

// wrapped(400);
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
