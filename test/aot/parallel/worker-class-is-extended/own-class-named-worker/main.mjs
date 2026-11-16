class Base {
  constructor(path) {
    this.path = path;
  }
}
class Worker extends Base {}
const name = process.argv[2] ?? "a";
console.log(new Worker("./jobs/" + name + ".mjs").path);
