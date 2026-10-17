// makes a Set from a literal of eight constant strings
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Set(["get", "head", "post", "put", "delete", "options", "trace", "patch"]).size;
}

console.log(sum);
