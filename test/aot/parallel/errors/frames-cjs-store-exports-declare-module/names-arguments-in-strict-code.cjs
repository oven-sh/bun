"use strict";
show("names arguments in strict code, at the top");
function inner() {
  show("names arguments in strict code, in a function");
}
inner();
[0].forEach(() => show("names arguments in strict code, in a callback"));
exports.count = arguments.length;
