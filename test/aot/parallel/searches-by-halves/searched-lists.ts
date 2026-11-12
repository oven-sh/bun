// A list of numbers that is searched by halves is read as Int32s; another storage, a hole and a place outside are read as before.
function search(list: number[], wanted: number, high: number): string { let low = 0, steps = 0; while (low < high) { const middle = (low + high) >> 1; if (++steps > 60) break; if (list[middle]! < wanted) low = middle + 1; else high = middle; } return low + "/" + steps; }
function closed(list: number[], wanted: number): number { let low = 0, high = list.length - 1; while (low <= high) { const middle = (low + high) >> 1; const at = list[middle]!; if (at < wanted) low = middle + 1; else if (at > wanted) high = middle - 1; else return middle; } return ~low; }
const ints: number[] = [], doubles: number[] = [], large: number[] = [], holes: number[] = new Array(64), broken: number[] = [];
for (let place = 0; place < 64; place++) { ints.push(place * 3); doubles.push(place * 1.5); large.push(place * 3000000000); if (place % 5) holes[place] = place * 3; broken.push(place === 40 ? NaN : place * 3); }
const lists = [ints, doubles, large, holes, broken];
for (const list of lists) for (const wanted of [-1, 0, 3, 60, 61.5, 189, 1e12]) console.log(search(list, wanted, list.length), search(list, wanted, 200), search(list, wanted, 10.5), closed(list, wanted));
ints.push(0.5);
console.log(closed(ints, 60), search(ints, 60, 64));
Object.setPrototypeOf(holes, Object.create(Array.prototype, { 20: { value: 60 }, 35: { get() { return 105; } } }));
console.log(closed(holes, 60), search(holes, 105, 64));
