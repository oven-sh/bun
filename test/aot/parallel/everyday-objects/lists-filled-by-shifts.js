// Lists filled at keys that are shifted, with bytes put together
function pack(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= (bytes[i] & 255) << (24 - (i % 4) * 8);
  }
  words[words.length - 1] ^= 1;
  const back = [];
  for (let i = 0; i < words.length * 4; i++) back.push((words[i >>> 2] >>> (24 - (i & 3) * 8)) & 255);
  return words.join() + " " + back.join() + " " + words.length;
}
console.log(pack([1, 2, 3, 4, 5]));
console.log(pack([255, 254, 253, 252, 251, 250, 249, 248]));
console.log(pack([0]));
