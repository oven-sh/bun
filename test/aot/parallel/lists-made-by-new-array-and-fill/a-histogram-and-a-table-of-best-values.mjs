const bytes = new Uint8Array(64); for (let i = 0; i < 64; i++) bytes[i] = (i * 37) & 255;
function tally(data) { const counts = new Array(16).fill(0); for (let i = 0; i < data.length; i++) counts[data[i] & 15]++; return counts.join(); }
function overflow(data) { const counts = new Array(4).fill(2147483646); for (let i = 0; i < data.length; i++) counts[data[i] & 3]++; return counts.join(); }
function fractions(data) { const sums = new Array(4).fill(0); for (let i = 0; i < data.length; i++) sums[data[i] & 3] += 0.5; return sums.join(); }
function beyond(data) { const counts = new Array(4).fill(0); for (let i = 0; i < data.length; i++) counts[data[i] & 7]++; return counts.join() + " " + counts.length; }
function best(room, weights) { const table = new Array(room + 1).fill(0); for (const weight of weights) for (let w = room; w >= weight; w--) { const value = table[w - weight] + weight * 3; if (value > table[w]) table[w] = value; } return table[room]; }
console.log(tally(bytes)); console.log(overflow(bytes)); console.log(fractions(bytes)); console.log(beyond(bytes)); console.log(best(20, [3, 5, 7, 9]));
