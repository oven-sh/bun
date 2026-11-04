function id(x) { return x; }
const lists = [id([{ a: 1 }, { b: 2 }]), id([{ c: 3 }]), id([])];
let sum = 0;
for (const list of lists) for (const each of list) sum += (each.a ?? 0) + (each.b ?? 0) * 10 + (each.c ?? 0) * 100;
console.log(sum, lists[2].length, JSON.stringify(lists));
