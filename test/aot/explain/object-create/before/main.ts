const defaults = { host: "localhost", port: 3000 };
const options = Object.create(defaults);
options.port = 8080;
console.log(options.host + ":" + options.port);
