// compares a string with constants, outside loops
const operations = 4;
let method: string = process.argv.length > 50 ? "POST" : "GET";
let total = 0;

kernel: {
  if (method === "GET") total += 1;
  if (method === "POST") total += 2;
  if (method === "PUT") total += 3;
  if (method === "HEAD") total += 4;
}

console.log(total);
