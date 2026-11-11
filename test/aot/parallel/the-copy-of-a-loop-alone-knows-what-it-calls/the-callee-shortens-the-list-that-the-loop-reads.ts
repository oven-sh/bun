function fill(length: number): number[] { if (length < 0) return fill(-length); const list: number[] = []; for (let i = 0; i < length; i++) list.push(i); return list; }
function each(list: number[], visit: (value: number) => void): void { for (let i = 0; i < list.length; i++) visit(list[i]); }
const first = fill(40), second = fill(40);
let seen = 0, other = 0;
each(first, value => { seen += value; if (value % 3 === 0) first.pop(); });
each(second, value => { other += value; if (value === 5) (second as any[])[7] = "x"; if (value === 9) second.length = 12; });
console.log(seen, other, first.length, second.length);
