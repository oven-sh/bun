// The proxies of the environment are looked at as the module loads, and one that is no URL throws there, not at the first request.
try {
  require("node:http");
  console.log("loaded");
} catch (error) {
  console.log(error.code, error.name);
}
