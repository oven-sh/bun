// A direct eval of a written string declares no other names than those that the string spells, so what else the function
// around it names is as known as elsewhere.
// STATISTIC: BuiltinCallsOnNarrowRow >= 3
function run(size) {
  eval("if (typeof collect === 'function') var collect = undefined");
  const module = (function (global, buffer) {
    var floats = new global.Float32Array(buffer);
    return function (count) {
      var sum = 0;
      for (var index = 0; index < count; index++) floats[index] = index * 0.5;
      for (var index = 0; index < count; index++) sum = sum + floats[index];
      return sum;
    };
  })({ Float32Array: Float32Array }, new ArrayBuffer(size * 4));
  return module(size) + (typeof collect === "undefined" ? 0.25 : 0);
}
console.log(run(16), run(1000));
function hides(text) {
  eval("var Math = { floor: value => 'hidden ' + value }");
  return Math.floor(text);
}
function mayHide(text) {
  eval(text);
  return Math.floor(2.5);
}
console.log(hides(1), mayHide("var Math = { floor: () => 'hidden' }"), mayHide("0"), Math.floor(1.5));
function escapes() {
  eval("var \\u004dath = { floor: () => 'spelled' }");
  eval("eval('var par' + 'se = 3')");
  return [Math.floor(1), typeof parse].join();
}
console.log(escapes());
