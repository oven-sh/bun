// `stop` of the default export is a getter beside a setter. It is served, the getter runs and the setter does not.
console.debug = (line: string) => {
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
  set stop(value) {
    console.log("stop is written", value);
  }
  fetch() {
    return new Response("served");
  }
}

export default new Config();
