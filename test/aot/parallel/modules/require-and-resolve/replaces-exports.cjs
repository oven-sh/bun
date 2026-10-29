module.exports = {
  current: "the first value",
  replace(value) {
    module.exports = value;
  },
};
