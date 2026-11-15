import "./requires-back.cjs";
console.log("importer begins");
import("./on-demand.cjs").then(() => console.log("importer then on-demand"));
console.log("importer ends");
