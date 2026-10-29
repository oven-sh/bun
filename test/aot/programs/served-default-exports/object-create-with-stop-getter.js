// The default export is made by Object.create() from an object with a getter named `stop`.
console.debug = line => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

const config = Object.create({
  get stop() {
    console.log("stop is read");
    return undefined;
  },
});
config.port = 0;
config.fetch = () => new Response("served");

export default config;
