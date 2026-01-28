// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

"use strict";

const Transform = require("internal/streams/transform");

function PassThrough(options): void {
  if (!(this instanceof PassThrough)) return new PassThrough(options);

  Transform.$call(this, options);
}
$toClass(PassThrough, "PassThrough", Transform);

PassThrough.prototype._transform = function (chunk, encoding, cb) {
  cb(null, chunk);
};

export default PassThrough;
