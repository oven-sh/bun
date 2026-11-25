exports.read = name => {
  const value = require(name);
  return typeof value + " " + JSON.stringify(value.default ?? value);
};
exports.resolve = name => require.resolve(name).split("/").pop();
