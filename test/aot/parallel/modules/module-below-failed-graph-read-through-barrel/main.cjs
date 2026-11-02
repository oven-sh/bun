// As its neighbor "runs-for-next-graph", but both importers reach shared.mjs through a module that only hands its names on.
import("./first.mjs").then(
  () => console.log("first loaded"),
  error => {
    console.log("first rejected:", error.message);
    setTimeout(() => import("./third.mjs").then(() => console.log("third loaded"), error => console.log("third rejected:", error.message)), 1);
  },
);
