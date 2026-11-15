const lines = (globalThis.lines ??= []);
lines.push("second begins");
try {
  lines.push("second got " + require("./main.mjs").answer);
} catch (error) {
  lines.push("second caught " + error.name);
}
lines.push("second ends");
