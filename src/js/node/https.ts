// Hardcoded module "node:https"
const http = require("node:http");

function request(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL)) {
    input.protocol ??= "https:";
  } else if (typeof options === "object") {
    options.protocol ??= "https:";
  }

  return http.request(input, options, cb);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

export default {
  ...http,
  get,
  request,
};
