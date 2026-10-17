// makes an instance, gives it an undeclared property and then creates four declared optional fields; the receiver's type is inferred
class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
const operations = 100;
const all: unknown[] = [];

kernel: {
  for (let i = 0; i < operations; i++) {
    const options = new Options();
    (options as any).tag = i;
    options.host = "localhost";
    options.port = i;
    options.path = "/";
    options.secure = false;
    all.push(options);
  }
}

console.log(Object.keys(all[operations - 1] as object).join());
