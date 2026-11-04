import("./b.mjs").then(
  () => console.log("b is in"),
  error => console.log("rejected: " + error.name),
);
export const value = "C".toLowerCase();
