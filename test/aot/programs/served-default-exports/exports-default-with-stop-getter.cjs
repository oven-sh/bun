// `exports.default` of a CommonJS file marked `__esModule` is an instance of a class with a getter named `stop`.
console.debug = line => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

class Config {
  port = 0;
  get stop() {
    console.log("stop is read");
    return undefined;
  }
  fetch() {
    return new Response("served");
  }
}

Object.defineProperty(exports, "__esModule", { value: true });
exports.default = new Config();
