let sum = 0;
const numbers = Array.from({ length: 20000 }, (_, i) => (i * 2654435761) % 100003);
for (let round = 0; round < 12; round++) {
  sum += numbers.map(n => n * 2).filter(n => n % 3 === 0).reduce((a, b) => a + b, 0);
  sum += [...numbers].sort((a, b) => a - b)[round] + numbers.toSorted()[round] + numbers.indexOf(round) + numbers.includes(-1);
  sum += numbers.slice(10, 5000).concat(numbers.slice(0, 10)).reverse().length + numbers.flatMap(n => (n & 1 ? [n] : [])).length;
  const grown = [];
  for (let i = 0; i < 20000; i++) grown.push(i & 1 ? i : i + 0.5);
  while (grown.length > 10) sum += grown.pop();
  const mixed = [1, "two", { three: 3 }, [4], null];
  for (let i = 0; i < 20000; i++) { mixed.splice(2, 1, i); mixed.unshift(mixed.pop()); }
  sum += mixed.length + numbers.findLast(n => n < 50) + numbers.join(",").length;
}
const floats = new Float64Array(50000), bytes = new Uint8Array(50000);
for (let round = 0; round < 20; round++) for (let i = 0; i < floats.length; i++) { floats[i] = i * 0.5 + round; bytes[i] = floats[i]; sum += bytes[i]; }
sum += floats.subarray(5, 500).map(x => x + 1).reduce((a, b) => a + b, 0) + new DataView(bytes.buffer).getUint32(8);
const [first, , third = 3, ...rest] = numbers;
console.log(sum + first + third + rest.length);
