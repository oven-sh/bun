// first.mjs imports shared.mjs and a CommonJS file that throws while the graph is loaded, so shared.mjs has not run when the import() is rejected. The next graph that imports it runs it.
import("./first.mjs").then(
  () => console.log("first loaded"),
  error => {
    console.log("first rejected:", error.message);
    setTimeout(() => import("./third.mjs").then(() => console.log("third loaded"), error => console.log("third rejected:", error.message)), 1);
  },
);
