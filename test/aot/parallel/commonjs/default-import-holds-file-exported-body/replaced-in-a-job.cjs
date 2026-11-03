exports.count = 0;
Promise.resolve().then(() => {
  module.exports = { count: -1 };
});
