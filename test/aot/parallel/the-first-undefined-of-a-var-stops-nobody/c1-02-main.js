var tally = (function () {
  var total = 0;
  function add(n) { total = total + n; return total; }
  function read() { return total; }
  return { add: add, read: read };
})();
console.log(tally.add(2), tally.add(3), tally.read());
