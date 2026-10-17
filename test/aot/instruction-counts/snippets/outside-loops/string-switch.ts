// switches on a string, outside loops
const operations = 1;
let method: string = process.argv.length > 50 ? "POST" : "DELETE";
let total = 0;

kernel: {
  switch (method) {
    case "GET":
      total += 1;
      break;
    case "POST":
      total += 2;
      break;
    case "PUT":
      total += 3;
      break;
    case "DELETE":
      total += 4;
      break;
  }
}

console.log(total);
