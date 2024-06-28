import { performance } from "node:perf_hooks";

const fn = () => {
  console.log("this is the function that will be timed");
};

let wrapped = performance.timerify(fn);
wrapped();
