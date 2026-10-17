// makes an instance of a class and creates four declared fields that it is born without
class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
  fill(port: number): void {
    this.host = "localhost";
    this.port = port;
    this.path = "/";
    this.secure = false;
  }
}
const operations = 100;
const made: Options[] = [];
for (let i = 0; i < operations; i++) made.push(new Options());
let total = 0;

kernel: {
  for (let i = 0; i < made.length; i++) {
    const options = new Options();
    options.fill(i);
    made[i] = options;
  }
  total += made[7].port ?? 0;
}

console.log(total);
