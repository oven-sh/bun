function Ok() {}
function Err() {}
Ok.defaults = { size: 1 };
let sum = 0;
for (let i = 0; i < 300; i++) sum += Ok.defaults.size;
const pick = JSON.parse("true") ? Ok : Err;
pick.defaults.size = "big";
console.log(sum, typeof Ok.defaults.size, Ok.defaults.size);
