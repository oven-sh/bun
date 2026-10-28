console.log("second runs");
import("./first.mjs").then(
  first => console.log("second has first", first.name),
  error => console.log("second fails", error.name),
);
