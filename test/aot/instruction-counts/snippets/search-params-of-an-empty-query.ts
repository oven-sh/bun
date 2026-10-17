// walks a URLSearchParams made from a query without pairs
const texts = ["", "?"];
const operations = 40;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const query = new URLSearchParams(texts[i & 1]);
    for (const [name] of query) sum += name.length;
    sum += query.size;
  }
}

console.log(sum);
