export const mask = { apply(key, data) { for (let i = 0; i < data.length; i++) data[i] ^= key[i & 3]; return data; } };
console.log(mask.apply([1, 2, 3, 4], Buffer.from([5, 6, 7, 8, 9])).join());
