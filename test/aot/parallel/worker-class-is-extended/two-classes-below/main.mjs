class First extends Worker {}
class Second extends First {
  get label() {
    return "second";
  }
}
const name = process.argv[2] ?? "a";
const worker = new Second(new URL(`./jobs/${name}.mjs`, import.meta.url));
console.log(worker.label);
worker.onmessage = event => {
  console.log(event.data);
  worker.terminate();
};
