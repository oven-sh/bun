// makes a Response from a string, a status and three headers
const operations = 20;
const bodies = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++)
    sum += new Response(bodies[i & 3], { status: 200 + i, headers: { "Content-Type": "text/plain", "X-Request-Id": bodies[(i + 1) & 3], "Cache-Control": "no-store" } }).status;
}

console.log(sum);
