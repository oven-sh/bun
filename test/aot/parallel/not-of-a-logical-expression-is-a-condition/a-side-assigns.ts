// a side assigns
let n = 0;
function ask(a: any): boolean { let x; const answer = !((x = a) && (n += 1)); return answer === !x || answer; }
for (const a of [0, 1, "", "x"]) console.log(String(a), ask(a), n);
