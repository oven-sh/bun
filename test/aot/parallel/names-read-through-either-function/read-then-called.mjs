let last = 0;
function Ok() {}
function Err() {}
Ok.of = function (v) { last = v; return v; };
let sum = 0;
for (let i = 0; i < 300; i++) sum += Ok.of(i);
const pick = JSON.parse("true") ? Ok : Err; const of = pick.of; of("text");
console.log(sum, typeof last, String(last));
