"use strict";

const ArrayPrototypePop = Array.prototype.pop;

const { isIterable, isNodeStream, isWebStream } = require("internal/streams/utils");
const { pipelineImpl: pl } = require("internal/streams/pipeline");
const { finished } = require("internal/streams/end-of-stream");

// require("internal/stream");

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
      const options = ArrayPrototypePop.$call(streams);
      signal = options.signal;
      end = options.end;
    }

    let lastStream = streams[streams.length - 1];
    if (streams.length === 1 && $isArray(lastStream)) {
      lastStream = lastStream[lastStream.length - 1];
    }

    const stream = pl(
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

    // Nothing consumes the proxy PassThrough of a function tail. Drain it (nodejs/node#65559).
    if (typeof lastStream === "function" && stream.readable) {
      stream.resume();
    }
  });
}

export default {
  finished,
  pipeline,
};
