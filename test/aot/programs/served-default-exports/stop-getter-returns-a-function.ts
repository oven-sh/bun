// The getter named `stop` answers a function, so the default export counts as a server that runs already and is not served.
console.debug = (line: string) => console.log("served", line.length > 0);

class Config {
  port = 0;
  get stop() {
    console.log("stop is read");
    return () => {};
  }
  fetch() {
    return new Response("served");
  }
}

export default new Config();
