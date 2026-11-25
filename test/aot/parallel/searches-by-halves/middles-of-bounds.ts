// low + ((high - low) >> 1) keeps the range of both bounds; a difference or a sum that wraps is computed as written.
const list: number[] = [];
for (let place = 0; place < 100; place++) list.push(place * 3);
const view = new Int32Array(100).map((_, place) => place * 3);
function inList(wanted: number): number { let low = 0, high = list.length - 1; while (low <= high) { const middle = low + ((high - low) >> 1); const at = list[middle]!; if (at < wanted) low = middle + 1; else if (at > wanted) high = middle - 1; else return middle; } return ~low; }
function inView(wanted: number): number { let low = 0, high = view.length; while (low < high) { const middle = ((high - low) >> 1) + low; if (view[middle]! < wanted) low = middle + 1; else high = middle; } return low; }
function between(low: number, high: number): string { const places: number[] = []; for (let step = 0; low < high && step < 40; step++) { const middle = low + ((high - low) >> 1); places.push(middle); if (step & 1) low = middle + 1; else high = middle; } return places.join(); }
function backwards(low: number, high: number): string { const places: number[] = []; for (let step = 0; low < high && step < 12; step++) { const middle = low + ((low - high) >> 1); places.push(middle, high + ((high - low) >> 1), low + ((high - low) >> 2)); low = low + 3; } return places.join(); }
for (const wanted of [-5, 0, 3, 4, 150, 296, 297, 298, 0.5, NaN]) console.log(wanted, inList(wanted), inView(wanted));
for (const [low, high] of [[0, 10], [-7, 8], [0, 2147483647], [-2147483648, 2147483647], [-1073741824, 1073741823], [-1073741825, 1073741824], [0, 4294967296], [0.5, 9.5], [5, 5], [-3, Infinity]]) console.log(low, high, between(low!, high!), backwards(low!, high!));
