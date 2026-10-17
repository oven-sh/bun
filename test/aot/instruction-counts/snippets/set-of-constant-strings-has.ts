// asks a Set made from a literal of twelve constant strings for a string that it holds
const operations = 96;
const methods = new Set(["get", "head", "post", "put", "delete", "options", "trace", "patch", "connect", "link", "unlink", "purge"]);
const asked: string[] = [];
for (let i = 0; i < operations; i++) asked.push(["ge", "t"].join("") + "", "pur" + "ge".slice(0), "op" + "tions".slice(0));
asked.length = operations;
let total = 0;

kernel: {
  let count = 0;
  for (let i = 0; i < asked.length; i++) if (methods.has(asked[i])) count += 1;
  total += count;
}

console.log(total);
