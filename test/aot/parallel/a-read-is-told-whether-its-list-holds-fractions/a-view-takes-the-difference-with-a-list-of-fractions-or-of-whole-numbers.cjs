const fractions = JSON.parse("[" + Array.from({ length: 60 }, (_, i) => i + 0.5).join() + "]");
const whole = JSON.parse("[" + Array.from({ length: 60 }, (_, i) => i * 3).join() + "]");
const key = JSON.parse('"less"');
const table = { less(list) { const view = Float64Array.from(list); for (let i = 0; i < list.length; i++) view[i] = view[i] * 2 - list[i]; return view[5] + view[59]; } };
const out = [];
for (let round = 0; round < 60; round++) out.push(table[key](round % 3 ? fractions : whole));
console.log(out.slice(-6).join());
