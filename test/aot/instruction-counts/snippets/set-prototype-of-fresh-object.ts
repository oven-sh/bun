// gives a fresh object another prototype
const parent = { kind: "parent" };
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = { name: "n", size: i };
    Object.setPrototypeOf(made, parent);
    total += made.size;
  }
}

console.log(total);
