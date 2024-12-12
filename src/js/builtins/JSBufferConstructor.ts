// This is marked as a constructor because Node.js allows `new Buffer.from`,
// Some legacy dependencies depend on this, see #3638
$constructor;
export function from(value, encodingOrOffset, length) {
  return require("internal/buffer").from(value, encodingOrOffset, length);
}

export function isBuffer(bufferlike) {
  return bufferlike instanceof $Buffer;
}
