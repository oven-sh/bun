// The upper bound of a search by halves that enters as a value of any type is asked for half the range of an int32.
const view = new Int32Array(80).map((_, place) => place * 3);
function inView(wanted: number): number { let low = 0, high = view.length; while (low < high) { const middle = (low + high) >> 1; if (view[middle]! < wanted) low = middle + 1; else high = middle; } return low; }
function below(wanted: number, top: any): string { let low = 0, high = top, steps = 0; while (low < high) { if (++steps > 50) break; const middle = (low + high) >> 1; if (view[middle]! < wanted) low = middle + 1; else high = middle; } return low + "," + String(high) + "/" + steps; }
for (const wanted of [-1, 0, 6, 7, 237, 238, 1000]) console.log(wanted, inView(wanted));
for (const top of [80, "60", 79.5, null, undefined, true, 2147483647, 4294967295, -5, { valueOf: () => 33 }, NaN]) console.log(below(100, top), below(1000, top));
