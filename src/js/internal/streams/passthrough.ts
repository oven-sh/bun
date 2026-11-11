// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

"use strict";

const Transform = require("internal/streams/transform");

declare global {
  namespace $Node {
    interface PassThrough extends Transform {}

    interface PassThroughConstructor {
      new (options?: TransformOptions): PassThrough;
      (this: PassThrough, options?: TransformOptions): void;
      prototype: any;
    }
  }
}

function PassThrough(this: $Node.PassThrough, options?: $Node.TransformOptions): void {
  if (!(this instanceof PassThrough)) return new PassThrough(options) as any;

  Transform.$call(this, options);
}
$toClass(PassThrough, "PassThrough", Transform);

PassThrough.prototype._transform = function (
  this: $Node.PassThrough,
  chunk: unknown,
  encoding: string,
  cb: $Node.TransformCallback,
) {
  cb(null, chunk);
};

export default PassThrough as $Node.PassThroughConstructor;
