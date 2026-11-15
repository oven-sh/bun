module.exports = function replace(other) {
  other.exports = { replacedBy: "another module", had: Object.keys(other.exports).join() };
};
