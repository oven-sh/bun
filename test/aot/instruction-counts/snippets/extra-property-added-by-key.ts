// gives an instance its first undeclared property under a computed key
class Options {
  host = "localhost";
  port = 80;
}
const operations = 100;
const key: string = ["t", "ag"].join("");
const all: any[] = [new Options()];
for (let i = 1; i < operations; i++) all.push(new Options());

kernel: {
  for (let i = 0; i < all.length; i++) all[i][key] = i;
}

console.log(Object.keys(all[operations - 1]).join());
