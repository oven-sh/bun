const seen = [];
exports.read = name => {
  const value = require(name);
  const isKnown = seen.includes(value);
  seen.push(value);
  return Object.keys(value).join() + " " + typeof value.default + " " + JSON.stringify(value.default ?? value) + " " + isKnown;
};
