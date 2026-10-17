// makes a Response from another Response and its body
const operations = 20;
const bodies = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const first = new Response(bodies[i & 3], { status: 200 + i });
    sum += new Response(first.body, first).status;
  }
}

console.log(sum);
