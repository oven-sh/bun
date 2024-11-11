"use strict";

const { ArrayPrototypePop, Promise } = require("internal/primordials");

const { isIterable, isNodeStream, isWebStream } = require("internal/streams/utils");

const { pipelineImpl: pl } = require("internal/streams/pipeline");
const { finished } = require("internal/streams/end-of-stream");

// require("node:stream");

function pipeline(...streams) {
  return new Promise((resolve, reject) => {
    let signal;
    let end;
    const lastArg = streams[streams.length - 1];
    if (
      lastArg &&
      typeof lastArg === "object" &&
      !isNodeStream(lastArg) &&
      !isIterable(lastArg) &&
      !isWebStream(lastArg)
    ) {
      const options = ArrayPrototypePop(streams);
      signal = options.signal;
      end = options.end;
    }

    pl(
      streams,
      (err, value) => {
        if (err) {
          reject(err);
        } else {
          resolve(value);
        }
      },
      { signal, end },
    );
  });
}

export default {
  finished,
  pipeline,
};
