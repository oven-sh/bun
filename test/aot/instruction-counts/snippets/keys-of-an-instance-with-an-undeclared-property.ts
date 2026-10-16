// lists the keys of an instance that has an undeclared property
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
let sum = 0;

kernel: {
  for (let i = 0; i < all.length; i++) sum += Object.keys(all[i]).length;
}

console.log(sum);
