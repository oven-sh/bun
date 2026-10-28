"use strict";
show("runs a direct eval in strict code, at the top");
function inner() {
  show("runs a direct eval in strict code, in a function");
}
inner();
[0].forEach(() => show("runs a direct eval in strict code, in a callback"));
exports.answer = eval("1 + 1");
