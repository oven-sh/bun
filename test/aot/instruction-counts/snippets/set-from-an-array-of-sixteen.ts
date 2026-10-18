// makes a Set from an array of sixteen strings
const lists = [
  ["get", "put", "post", "head", "patch", "trace", "delete", "options", "connect", "link", "unlink", "purge", "lock", "unlock", "copy", "move"],
  ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "a", "b"],
];
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Set(lists[i & 1]).size;
}

console.log(sum);
