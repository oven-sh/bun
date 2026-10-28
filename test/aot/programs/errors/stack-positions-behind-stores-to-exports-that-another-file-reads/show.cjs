exports.show = function show(label) {
  const lines = String(new Error().stack).split("\n");
  const index = lines.findIndex(text => /at toString/.test(text));
  const found = /:(\d+):(\d+)\)?$/.exec(lines[index + 1] ?? "");
  console.log(label, found ? found[1] + ":" + found[2] : "none");
  return "text";
};
exports.id = (...values) => values.length;
exports.Base = class Base {};
