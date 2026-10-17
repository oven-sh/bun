// creates four declared optional fields in an instance that was first given an undeclared property; the receiver's type is known
class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
const operations = 100;
const makeOptions = (i: number) => {
  const options = new Options();
  (options as any).tag = i;
  return options;
};
const all = [makeOptions(0)];
for (let i = 1; i < operations; i++) all.push(makeOptions(i));

kernel: {
  for (let i = 0; i < all.length; i++) {
    const options = all[i];
    options.host = "localhost";
    options.port = i;
    options.path = "/";
    options.secure = false;
  }
}

console.log(Object.keys(all[operations - 1]).join());
