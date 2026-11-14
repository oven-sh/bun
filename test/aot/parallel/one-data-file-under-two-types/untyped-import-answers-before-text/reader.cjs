exports.read = (name, expected) => {
  const value = require(name);
  return Object.keys(value).join() + " " + typeof value.default + " " + (value === expected);
};
