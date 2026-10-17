// makes a JSON Response from an object alone
const operations = 20;
const titles = ["one", "two", "three", "four"];
let sum = 0;

kernel: {
  for (let i = 0; i < operations; i++) sum += Response.json({ id: i, title: titles[i & 3] }).status;
}

console.log(sum);
