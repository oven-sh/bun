// collects the three pairs of a URLSearchParams that is only read into an object
const texts = ["page=2&limit=10&sort=old", "page=3&limit=20&sort=new"];
const operations = 20;
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const query = new URLSearchParams(texts[i & 1]);
    const found: Record<string, string> = Object.create(null);
    for (const [name, value] of query) found[name] = value;
    sum += query.size + found.page!.length + query.toString().length;
  }
}

console.log(sum);
