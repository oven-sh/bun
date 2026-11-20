// As esbuild, Bun and swc print it: the function answers the object, and the variable is born with it.
var Levels = /* @__PURE__ */ (Levels2 => {
  Levels2[Levels2["Low"] = -1] = "Low";
  Levels2[Levels2["High"] = 1] = "High";
  Levels2["Text"] = "text";
  return Levels2;
})(Levels || {});
function level(c) {
  switch (c) {
    case Levels.Low: return "low";
    case Levels.High: return "high";
    case Levels.Text: return "text";
    default: return "other";
  }
}
console.log(level(-1), level(1), level("text"), level(0), Object.keys(Levels).join());
