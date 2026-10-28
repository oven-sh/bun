// The getter named `stop` is inherited from a base class of the default export's class.
console.debug = (line: string) => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

class Base {
  get stop() {
    console.log("stop is read on", this.constructor.name);
    return undefined;
  }
}

class Config extends Base {
  port = 0;
  fetch() {
    return new Response("served");
  }
}

export default new Config();
