console.log("inner runs");
import("./outer.mjs").then(
  outer => console.log("inner has outer", outer.name),
  error => console.log("inner fails", error.name),
);
