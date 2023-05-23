// src/js/node/stream.promises.js
var { promises } = import.meta.require("node:stream");
var { pipeline, finished } = promises;
var stream_promises_default = {
  pipeline,
  finished,
  [Symbol.for("CommonJS")]: 0
};
export {
  pipeline,
  finished,
  stream_promises_default as default
};

//# debugId=7109BF753AC653DD64756e2164756e21
