var Counter = (function (step) {
  var made = 0;
  function Counter() { this.id = made += step; }
  Counter.prototype.next = function () { return this.id + step; };
  return Counter;
})(3);
console.log(new Counter().id, new Counter().next(), new Counter() instanceof Counter);
