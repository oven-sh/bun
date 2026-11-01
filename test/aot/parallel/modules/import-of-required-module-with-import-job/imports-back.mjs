turns("imports-back");
import("./running.mjs").then(
  names => seen.push("<fulfilled, ended: " + names.ended + ">"),
  error => seen.push("<rejected, " + error.message + ">"),
);
