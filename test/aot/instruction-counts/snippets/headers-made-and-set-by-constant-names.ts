// makes a Headers object, sets two headers by constant names and makes a Response with it
const operations = 20;
const values = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const headers = new Headers();
    headers.set("cache-control", "no-store");
    headers.set("x-request-id", values[i & 3]);
    sum += new Response(null, { headers }).status;
  }
}

console.log(sum);
