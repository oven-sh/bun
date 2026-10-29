// Array methods that take a callback, called in a loop: the method and its callback are inlined, but not the method's slow loop for sparse arrays.
// IRM= 0 = Array(HasIndex|GetIndex) 
// IR= 1 mapFrom = ArrayHasIndex 
// IR= 1 filterFrom = ArrayHasIndex 
interface Item { id: number; name: string; on: boolean }
function names(items: Item[]): string[] { return items.map(i => i.name + "!") }
function ids(items: Item[]): number[] { return items.map(i => i.id) }
function doubled(xs: number[]): number[] { return xs.map(x => x * 2) }
function active(items: Item[]): Item[] { return items.filter(i => i.on) }
const data: Item[] = [{ id: 1, name: "a", on: true }, { id: 2, name: "b", on: false }]
let n = 0
for (let r = 0; r < 100; r++) n += names(data).length + active(data).length + ids(data).length + doubled([1, 2.5]).length
const sparse: Item[] = [data[0]]
sparse[3] = data[1]
console.log(n, names(sparse).length, 1 in names(sparse), active(sparse).length, ids(sparse).join())
