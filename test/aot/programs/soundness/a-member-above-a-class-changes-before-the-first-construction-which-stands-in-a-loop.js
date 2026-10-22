var unseen = new Function("x", "return x");

function Above() {}
Above.prototype.who = function () { return "above"; };
class Below extends Above {
  own() { return "own"; }
}
class Beside extends Above {
  own() { return "beside"; }
}
new Above();
unseen(Above).prototype.who = function () { return "replaced"; };
function askEach(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = index & 1 ? new Beside() : new Below();
    answers += made.who() + "-" + made.own() + " ";
  }
  return answers;
}
console.log(askEach(4));
console.log(askEach(4));

function Above2() {}
Above2.prototype.who = function () { return "above"; };
class Below2 extends Above2 {
  own() { return "own"; }
}
class Beside2 extends Above2 {
  own() { return "beside"; }
}
new Above2();
unseen(Below2).prototype.who = function () { return "hidden"; };
function askEach2(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = index & 1 ? new Beside2() : new Below2();
    answers += made.who() + "-" + made.own() + " ";
  }
  return answers;
}
console.log(askEach2(4));
console.log(askEach2(4));

function Above3() {}
Above3.prototype.who = function () { return "above"; };
Above3.prototype.size = 1;
class Below3 extends Above3 {
  own() { return "own"; }
}
class Beside3 extends Above3 {
  own() { return "beside"; }
}
new Above3();
Object.setPrototypeOf(unseen(Below3).prototype, { who: function () { return "between"; }, size: 2 });
function askEach3(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = index & 1 ? new Beside3() : new Below3();
    answers += made.who() + "-" + made.own() + "-" + made.size + " ";
  }
  return answers;
}
console.log(askEach3(4));
console.log(askEach3(4));

var key = unseen("who");
function Above4() {}
Above4.prototype.who = function () { return "above"; };
class Below4 extends Above4 {
  [key]() { return "computed"; }
  own() { return "own"; }
}
class Beside4 extends Above4 {
  own() { return "beside"; }
}
function askEach4(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = index & 1 ? new Beside4() : new Below4();
    answers += made.who() + "-" + made.own() + " ";
  }
  return answers;
}
console.log(askEach4(4));
console.log(askEach4(4));

function Above5() {}
Above5.prototype.who = function () { return "above"; };
class Below5 extends Above5 {
  own() { return "own"; }
}
delete unseen(Above5).prototype.who;
Object.setPrototypeOf(unseen(Above5).prototype, { who: function () { return "beyond"; } });
function askEach5(count) {
  var answers = "";
  for (var index = 0; index < count; index++) {
    var made = new Below5();
    answers += made.who() + "-" + made.own() + " ";
  }
  return answers;
}
console.log(askEach5(3));
console.log(askEach5(3));
