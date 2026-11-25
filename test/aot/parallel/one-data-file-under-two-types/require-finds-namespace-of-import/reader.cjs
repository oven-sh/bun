const names = ["./settings.toml", "./list.yaml", "./note.json"];
exports.readNames = (name, expected) => {
  if (!name) return names;
  const value = require(name);
  if (expected) return value === expected;
  return Object.keys(value).join() + " " + typeof value.default + " " + JSON.stringify(value.default ?? value);
};
