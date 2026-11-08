let last = 0;
function Ok() {}
function Err() {}
Ok.of = function (v) { last = v; return v; };
const pick = JSON.parse("true") ? Ok : Err;
const of = pick.of; of("text");
console.log(typeof last, String(last));
