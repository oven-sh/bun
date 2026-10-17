// makes a Response from a string and a status
const operations = 20;
const bodies = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += new Response(bodies[i & 3], { status: 200 + i }).status;
}

console.log(sum);
