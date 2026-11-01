// As its neighbor "runs-for-next-graph", but the importers hold the namespace object of shared.mjs.
import("./first.mjs").then(
  () => console.log("first loaded"),
  error => {
    console.log("first rejected:", error.message);
    setTimeout(() => import("./third.mjs").then(() => console.log("third loaded"), error => console.log("third rejected:", error.message)), 1);
  },
);
