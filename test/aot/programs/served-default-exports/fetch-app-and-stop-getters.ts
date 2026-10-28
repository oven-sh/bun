// `fetch`, `app` and `stop` are getters of the default export's class. They run in the order in which they are asked for.
console.debug = (line: string) => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

class Config {
  port = 0;
  get fetch() {
    console.log("fetch is read");
    return () => new Response("served");
  }
  get app() {
    console.log("app is read");
    return undefined;
  }
  get stop() {
    console.log("stop is read");
    return undefined;
  }
}

export default new Config();
