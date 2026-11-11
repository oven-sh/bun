exports.default = {
  port: 0,
  fetch() {
    return new Response("never asked");
  },
};
exports.fetch = exports.default.fetch;
console.log("the file runs");
