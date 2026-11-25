function bump(k) { const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]; for (let i = 0; i < 3; i++) list[(k + i) & 15] += 100; return list.join(); } console.log(bump(0)); console.log(bump(0)); console.log(bump(5));
function short(k) { const list = [1, 2, 3]; for (let i = 0; i < 3; i++) list[(k + i) & 1] += 100; return list.join(); } console.log(short(0), short(0), short(1));
