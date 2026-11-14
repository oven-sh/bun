exports.read = name => {
  const value = require(name);
  return Object.keys(value).join() + " " + typeof value.default;
};
