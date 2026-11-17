var revealing = (function () {
  var count = 0;
  var kept = [];
  function keep(item) {
    count++;
    return kept.push(item);
  }
  function reset(newCount, newKept) {
    count = newCount;
    kept = newKept;
  }
  function report() {
    return [count + 1, kept.length];
  }
  return { keep: keep, reset: reset, report: report };
})();
if (typeof exports !== "undefined") {
  if (typeof module !== "undefined" && module.exports) exports = module.exports = revealing;
  exports.revealing = revealing;
}
