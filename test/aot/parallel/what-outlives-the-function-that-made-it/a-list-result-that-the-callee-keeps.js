const all = [1, 2, 3];
function get(i) { for (let k = 0; k < 1; k++) all.push(i); return all; }
function use(i) { const list = get(i); return list.length; }
console.log(use(7), use(8), all.join());
