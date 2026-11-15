module.exports = function walk(source) {
  let found = 0;
  for (const name in source) found += typeof source[name] === "function" ? 1 : 0;
  return found;
};
