var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/stream.consumers.js


// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
const arrayBuffer = Bun.readableStreamToArrayBuffer;
const text = Bun.readableStreamToText;
const json = stream => Bun.readableStreamToText(stream).then(JSON.parse);

const buffer = async readableStream => {
  return new Buffer(await arrayBuffer(readableStream));
};

const blob = Bun.readableStreamToBlob;

$ = {
  arrayBuffer,
  text,
  json,
  buffer,
  blob,
};
$$EXPORT$$($).$$EXPORT_END$$;
