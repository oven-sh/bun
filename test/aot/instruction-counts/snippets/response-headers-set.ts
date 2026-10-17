// sets two headers of a fresh Response by constant names
const operations = 20;
const values = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const response = new Response(null);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-request-id", values[i & 3]);
    sum += response.status;
  }
}

console.log(sum);
