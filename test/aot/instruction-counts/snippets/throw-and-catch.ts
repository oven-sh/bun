// throws a new Error and catches it
const operations = 20;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    try {
      throw new Error("no");
    } catch (error) {
      total += (error as Error).message.length;
    }
  }
}

console.log(total);
