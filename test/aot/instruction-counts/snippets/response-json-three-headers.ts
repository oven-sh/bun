// makes a JSON Response from an object, a status and three headers
const operations = 20;
const titles = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++)
    sum += Response.json({ id: i, title: titles[i & 3] }, { status: 200 + i, headers: { "X-Request-Id": titles[(i + 1) & 3], "Cache-Control": "no-store", "X-Frame-Options": "DENY" } }).status;
}

console.log(sum);
