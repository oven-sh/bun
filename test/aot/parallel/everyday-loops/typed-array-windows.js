// Views on one buffer that are written through each other
function blur(bytes, rounds) {
  const all = Int16Array.from(bytes);
  for (let r = 0; r < rounds; r++) {
    for (let i = 1; i + 1 < all.length; i++) {
      const view = all.subarray(i - 1, i + 2);
      view[1] = (view[0] + view[1] * 2 + view[2]) / 4;
      if (view[2] > 30000) view[2] += 10000;
    }
    all.set(all.subarray(0, 2), all.length > 3 ? all.length - 2 : 0);
  }
  return all.join() + " " + new Uint8Array(all.buffer).reduce((sum, byte) => sum + byte, 0);
}
console.log(blur([0, 100, 0, -100, 50], 2));
console.log(blur([32767, 1, 32767, 2, 32767], 1));
console.log(blur([1.9, -1.9], 3), blur([], 1));
