"use strict";
show("stores to exports in strict code, at the top");
function inner() {
  show("stores to exports in strict code, in a function");
}
inner();
[0].forEach(() => show("stores to exports in strict code, in a callback"));
exports = {};
exports.done = true;
