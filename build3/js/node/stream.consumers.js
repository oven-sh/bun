(function (){"use strict";// build3/tmp/node/stream.consumers.ts
var $;
var arrayBuffer = Bun.readableStreamToArrayBuffer;
var text = Bun.readableStreamToText;
var json = (stream) => Bun.readableStreamToText(stream).then(JSON.parse);
var buffer = async (readableStream) => {
  return new @Buffer(await arrayBuffer(readableStream));
};
var blob = Bun.readableStreamToBlob;
$ = {
  arrayBuffer,
  text,
  json,
  buffer,
  blob
};
return $})
