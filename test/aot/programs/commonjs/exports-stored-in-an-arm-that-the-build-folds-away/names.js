if (process.env.NODE_ENV === "production") {
  exports.kept = require("./not-there.js");
  exports.alsoKept = 5;
} else {
  exports.kept = "kept";
  exports.alsoKept = function () { return "called"; };
}
