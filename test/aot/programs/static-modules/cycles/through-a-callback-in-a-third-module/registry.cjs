const callbacks = {};
exports.add = (name, callback) => {
  callbacks[name] = callback;
};
exports.run = name => callbacks[name]();
