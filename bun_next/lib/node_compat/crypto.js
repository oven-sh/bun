const cryptoBinding = internalBinding('crypto');
const Buffer = require('buffer').Buffer;

module.exports = {
  createHash: (algo) => {
    let _data = "";
    const hashObj = {
      update: (data) => {
        if (typeof data === 'string') {
          _data += data;
        } else {
          _data += Buffer.from(data).toString('utf8');
        }
        return hashObj;
      },
      digest: (encoding) => {
        const hexHash = cryptoBinding.hash(algo, _data);
        const buf = Buffer.from(hexHash, 'hex');
        if (encoding === 'hex') {
          return hexHash;
        }
        if (encoding === 'base64') {
          return buf.toString('base64');
        }
        if (encoding) {
          return buf.toString(encoding);
        }
        return buf;
      }
    };
    return hashObj;
  },
  randomBytes: (size, callback) => {
    if (callback) {
      process.nextTick(() => {
        try {
          const bytes = cryptoBinding.randomBytes(size);
          callback(null, Buffer.from(bytes));
        } catch (err) {
          callback(err);
        }
      });
      return;
    }
    return Buffer.from(cryptoBinding.randomBytes(size));
  },
  randomFillSync: (buffer, offset = 0, size) => {
    if (!ArrayBuffer.isView(buffer)) {
      throw new TypeError('"buffer" must be a TypedArray or DataView');
    }
    if (size === undefined) {
      size = buffer.byteLength - offset;
    }
    const bytes = cryptoBinding.randomBytes(size);
    for (let i = 0; i < size; i++) {
      buffer[offset + i] = bytes[i];
    }
    return buffer;
  }
};
