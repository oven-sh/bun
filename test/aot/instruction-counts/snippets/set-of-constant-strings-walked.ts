// walks a Set made from a literal of twelve constant strings
const operations = 12;
const methods = new Set(["get", "head", "post", "put", "delete", "options", "trace", "patch", "connect", "link", "unlink", "purge"]);
let total = 0;

kernel: {
  let length = 0;
  for (const method of methods) length += method.length;
  total += length;
}

console.log(total);
