module.exports = [...globalThis.names, "./alone.cjs"].map(name => {
  try {
    const found = require(name);
    found.count = 5;
    found.name += " changed";
    return found.said ?? "a copy";
  } catch (error) {
    return error.code;
  }
});
