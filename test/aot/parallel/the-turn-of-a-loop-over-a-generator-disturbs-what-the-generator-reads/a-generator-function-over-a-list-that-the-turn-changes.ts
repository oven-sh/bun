// The loop of a generator is walked with the turn of its consumer inside it: a generator function over a list that the turn changes.
function* over(list: number[]) { for (const item of list) yield item; }
function total(list: number[]): string { let sum = 0; for (const item of over(list)) { if (item === 2) { list[2] = 0.5; list.push(4); } sum += item; } return sum + ":" + list.join(); }
for (let run = 0; run < 3; run++) console.log(total([1, 2, 3]));
