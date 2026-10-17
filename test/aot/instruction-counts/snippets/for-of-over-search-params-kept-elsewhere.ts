// walks the three pairs of a URLSearchParams that is also kept in an array
const kept: URLSearchParams[] = [];
const texts = ["page=2&limit=10&sort=old", "page=3&limit=20&sort=new"];
const operations = 20;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const query = new URLSearchParams(texts[i & 1]);
    kept[0] = query;
    for (const [name, value] of query) sum += name.length + value.length;
  }
}

console.log(sum, kept.length);
