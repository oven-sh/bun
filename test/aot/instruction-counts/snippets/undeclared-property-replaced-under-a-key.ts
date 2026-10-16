// stores to an undeclared property that an instance has already, under a computed key
class Options {
  host = "localhost";
  port = 80;
}
const operations = 100;
const key: string = ["t", "ag"].join("");
const makeOptions = (i: number): any => {
  const options = new Options();
  (options as any)[key] = i;
  return options;
};
const all: any[] = [makeOptions(0)];
for (let i = 1; i < operations; i++) all.push(makeOptions(i));

kernel: {
  for (let i = 0; i < all.length; i++) all[i][key] = i + 1;
}

console.log(all[operations - 1].tag);
