// reads a header of a Response by a constant name
const operations = 20;
const responses = [1, 2, 3, 4].map((n) => new Response("", { headers: { "content-type": "text/plain", "x-n": "n" + n } }));
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    sum += responses[i & 3].headers.get("content-type")!.length;
  }
}

console.log(sum);
