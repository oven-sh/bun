// copies an instance that has an undeclared property into an object literal
class Options {
  host = "localhost";
  port = 80;
}
const operations = 100;
const makeOptions = (i: number) => {
  const options = new Options();
  (options as any).tag = i;
  return options;
};
const all = [makeOptions(0)];
for (let i = 1; i < operations; i++) all.push(makeOptions(i));
const copies: object[] = [];

kernel: {
  for (let i = 0; i < all.length; i++) copies.push({ ...all[i] });
}

console.log(Object.keys(copies[operations - 1]).join());
