// a direct callee writes nothing but an element of a list, which its caller reads in front of the call and behind it
function fill(list: number[], depth: number) { list[0] = list[0] + 1; if (depth > 0) fill(list, depth - 1); }
function deed(list: number[]) { const before = list[0]; fill(list, 1); const between = list[0]; fill(list, 0); return before + " " + between + " " + list[0]; }
const held = [1, 2, 3];
console.log(deed(held));
let all = "";
for (let i = 0; i < 5; i++) all += deed(held) + ";";
console.log(all);
held[0] = 100;
console.log(deed(held));
