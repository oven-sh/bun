// a direct callee writes a variable of the module that its caller reads in front of the call and behind it
let count = 0;
function bump() { count = (count + 1) | 0; }
function deed() { const before = count; bump(); const between = count; bump(); return before + " " + between + " " + count; }
console.log(deed());
let all = "";
for (let i = 0; i < 5; i++) all += deed() + ";";
console.log(all);
count = 100;
console.log(deed());
