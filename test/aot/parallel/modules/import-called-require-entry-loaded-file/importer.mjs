import "./requires-back.cjs";
console.log("importer begins");
let ticks = 0;
const count = () => {
  console.log("tick", ++ticks);
  if (ticks < 6) Promise.resolve().then(count);
};
Promise.resolve().then(count);
import("./on-demand.cjs").then(() => console.log("importer then on-demand"));
console.log("importer ends");
