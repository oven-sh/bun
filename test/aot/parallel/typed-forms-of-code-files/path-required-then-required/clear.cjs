module.exports = (ask, path) => {
  delete ask.cache[ask.resolve(path)];
};
