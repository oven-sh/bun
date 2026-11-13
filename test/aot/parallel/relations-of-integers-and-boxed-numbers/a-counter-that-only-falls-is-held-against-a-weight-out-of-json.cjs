// STATISTIC: Int64ComparisonsWithBoxedNumbers >= 1
const parcels = JSON.parse('[{"weight":3,"worth":4.5},{"weight":1,"worth":2.25},{"weight":7,"worth":9},{"weight":2.5,"worth":1},{"weight":-2,"worth":0.5},{"weight":-0,"worth":0.125},{"weight":61,"worth":30},{"weight":2147483647,"worth":8},{"weight":2147483648,"worth":8},{"weight":4294967296,"worth":8},{"weight":1e300,"worth":8},{"weight":1e999,"worth":8},{"weight":null,"worth":0.0625}]');
function pack(list, turn) { const room = 60 + (turn & 3), best = new Array(room + 1).fill(0); for (const parcel of list) for (let left = room; left >= parcel.weight; left--) { const withIt = best[left - parcel.weight] + parcel.worth; if (withIt > best[left]) best[left] = withIt; } return best[room]; }
const ways = { pack, idle(list, turn) { return turn; } }, steps = JSON.parse('["pack"]');
function step(turn) { return ways[steps[0]](parcels, turn); }
let sum = 0; for (let turn = 0; turn < 40; turn++) sum = (sum + step(turn)) % 1000003; console.log(sum);
