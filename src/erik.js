// import { performance, createHistogram } from "node:perf_hooks";
// cannot use import statement outside a module, so we do:
const { performance, createHistogram } = require("perf_hooks");

const fn = () => {
  console.log("this is the function that will be timed");
};

const histogram = createHistogram();
histogram.update(2);
