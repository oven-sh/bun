console.log("imports-back runs");
import("./outer.mjs").then(
  names => console.log("import of outer: fulfilled, ended:", names.ended),
  error => console.log("import of outer: rejected,", error.message),
);
import("./inner.mjs").then(
  names => console.log("import of inner: fulfilled, ended:", names.ended),
  error => console.log("import of inner: rejected,", error.message),
);
