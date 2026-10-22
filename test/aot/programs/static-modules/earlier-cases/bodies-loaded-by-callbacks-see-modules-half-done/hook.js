require("./registry").on(function (what) {
  try {
    if (what === "barrel") return require("./plugin_barrel").seen;
    if (what === "lit") return require("./plugin_lit").seen;
    if (what === "prologue") return require("./plugin_prologue").seen;
    if (what === "fn") return require("./plugin_fn").seen;
  } catch (e) { return what + ":" + e.constructor.name; }
  return "";
});
