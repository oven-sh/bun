// import { performance, createHistogram } from "node:perf_hooks";
// cannot use import statement outside a module, so we do:
const { performance, createHistogram } = require("perf_hooks");

const fn = duration => {
  // sleep for duration ms
  const start = performance.now();
  while (performance.now() - start < duration) {}
};

let h = createHistogram();

let wrapped = performance.timerify(fn, { histogram: h });

wrapped(100);
console.log(h);
console.log(h.percentiles.get(75));
wrapped(400);
console.log(h);
console.log(h.percentiles.get(75));
wrapped(400);
console.log(h);
console.log(h.percentiles.get(75));
wrapped(400);
console.log(h);
console.log(h.percentiles.get(75));

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
