// The loader goes through the graph of first.mjs, because queues.cjs queues a job while the graph is loaded. The evaluation begins and ends at throws.mjs, in front of shared.mjs.
import("./first.mjs").then(
  () => console.log("first loaded"),
  error => {
    console.log("first rejected:", error.message);
    setTimeout(() => import("./third.mjs").then(() => console.log("third loaded"), error => console.log("third rejected:", error.message)), 1);
  },
);
