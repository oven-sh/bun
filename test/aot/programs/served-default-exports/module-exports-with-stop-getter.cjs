// `module.exports` is an instance of a class with `fetch` and a getter named `stop`.
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

module.exports = new Config();
