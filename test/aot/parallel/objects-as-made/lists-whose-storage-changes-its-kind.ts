const sparse: number[] = [1, 2, 3];
sparse[50000] = 4;
const holey: number[] = [1, 2, 3, 4];
delete holey[1];
const mixed: unknown[] = [1, 2];
mixed.push(0.5); mixed.push("text"); mixed.push({});
const shrunk: number[] = [1, 2, 3, 4, 5];
shrunk.length = 2;
const grown: number[] = [];
grown.length = 5;
function ask(list: unknown[]): string { let count = 0; for (let at = 0; at < list.length; at++) if (list[at] !== undefined) count++; let walked = 0; for (const x of list) if (x !== undefined) walked++; return [count, walked, list.length, list.indexOf(3), list.includes(undefined), list.lastIndexOf(2), list.slice(0, 3).join("-")].join(); }
let all = "";
for (let round = 0; round < 2; round++) all += [ask(sparse), ask(holey), ask(mixed), ask(shrunk), ask(grown)].join(";") + "#";
sparse.push(9); holey.push(9); shrunk.push(9); grown.push(9);
console.log(all, sparse.length, holey.length, shrunk.length, grown.length, sparse.pop(), holey.shift());
