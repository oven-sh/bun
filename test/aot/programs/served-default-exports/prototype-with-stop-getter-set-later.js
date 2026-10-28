// The default export gets a prototype with a getter named `stop` from Object.setPrototypeOf().
console.debug = line => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

const config = {
  port: 0,
  fetch() {
    return new Response("served");
  },
};
Object.setPrototypeOf(config, {
  get stop() {
    console.log("stop is read");
    return undefined;
  },
});

export default config;
