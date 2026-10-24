// Species: fiber programs  spread loop. It prints what plain Bun prints.
const base = { a: 1, b: 2, c: 3 };
function widen(object, extra) { return { ...object, d: extra }; }
function join(list, tail) { return [...list, tail]; }
let sum = 0, list = [1, 2, 3];
for (let round = 0; round < 300000; round++) { const wide = widen(base, round & 15); sum += wide.a + wide.b + wide.c + wide.d; const longer = join(list, round & 3); sum += longer[0] + longer[3] + longer.length; }
console.log(sum);
