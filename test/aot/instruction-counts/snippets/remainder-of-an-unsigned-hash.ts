// takes the remainder of an unsigned 32-bit hash, half of which are over 2^31, by a number of buckets
const operations = 100;
const hashes: number[] = [];
for (let i = 0; i < operations; i++) hashes.push(Math.imul(i + 1, 2654435761) | 0);
const buckets: number = [1021][0];
let total = 0;

kernel: {
  for (let i = 0; i < hashes.length; i++) total += (hashes[i] >>> 0) % buckets;
}

console.log(total);
