// looks a key up in a chain of entries of which nothing is known, comparing each entry's key with a parameter annotated string
function lookup(head: any, key: string): unknown {
  for (let entry = head; entry; entry = entry.parent) {
    if (entry.key === key) return entry.value;
  }
  return undefined;
}
const operations = 100;
let head: any = undefined;
for (let i = 0; i < 8; i++) head = { key: ["service/of/some/length/", String(i)].join(""), value: i, parent: head };
const asked: string[] = [];
for (let i = 0; i < operations; i++) asked.push(["service/of/some/length/", "0"].join(""));
let total = 0;

kernel: {
  for (let i = 0; i < asked.length; i++) total += lookup(head, asked[i]) as number;
}

console.log(total);
