const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function make(): number[] { return [1, 2, 3, 4, 5]; }
function cut(list: number[], to: number): string { list.length = to >>> 0; return list.join(); }
console.log(cut(make(), numbers[5]!), cut(make(), numbers[2]!), make().join(), cut(make(), numbers[0]!), make().join());
