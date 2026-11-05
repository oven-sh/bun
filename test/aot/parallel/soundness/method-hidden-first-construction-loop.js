// A method is hidden before the first construction which stands in a loop.
var unseen = new Function("x", "return x");
function Base() {}
Base.prototype.who = function () { return "base"; };
function Made() {}
Object.setPrototypeOf(Made.prototype, Base.prototype);
new Base();
unseen(Made).prototype.who = function () { return "hidden"; };
function askEach(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = new Made();
    answers += made.who() + " ";
  }
  return answers;
}
console.log(askEach(3));
console.log(askEach(3));

function Base2() {}
Base2.prototype.who = function () { return "base"; };
function Made2() {}
Made2.prototype = new Base2();
Object.setPrototypeOf(unseen(Made2).prototype, { who: function () { return "between"; } });
function askEach2(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = new Made2();
    answers += made.who() + " ";
  }
  return answers;
}
console.log(askEach2(3));
console.log(askEach2(3));

function Base3() {}
Base3.prototype.size = 1;
function Made3() {}
Made3.prototype = new Base3();
Object.setPrototypeOf(unseen(Made3).prototype, { size: 2 });
function sumEach(count) {
  var sum = 0;
  for (var index = 0; index < count; index++)
    sum += new Made3().size;
  return sum;
}
console.log(sumEach(3), sumEach(3));
