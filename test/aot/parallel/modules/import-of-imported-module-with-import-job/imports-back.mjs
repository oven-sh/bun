turns("imports-back", 10);
import("./running.mjs").then(
  names => seen.push("<second fulfilled, ended: " + names.ended + ">"),
  error => seen.push("<second rejected, " + error.message + ">"),
);
