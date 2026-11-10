function each(list, f) { let work = 0; for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) work = (work + j * k) | 0; for (let i = 0; i < list.length; i++) f(list[i], i); for (let k = 0; k < 2; k++) work = (work ^ k) | 0; return work; }
function total(list, start) { let sum = start; each(list, row => { sum += row.id; }); return sum; }
let all = 0; for (let t = 0; t < 500; t++) all += total([], t); console.log(all, total([], "x"), total([], undefined), total([{ id: 2 }], 1));
