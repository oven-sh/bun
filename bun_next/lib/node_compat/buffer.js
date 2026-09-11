// Implémentation de Buffer basée sur Uint8Array avec support d'encodages robustes

const b64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64Lookup = new Uint8Array(256);
for (let i = 0; i < b64Chars.length; i++) {
  b64Lookup[b64Chars.charCodeAt(i)] = i;
}

function stringToUtf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      i++;
      code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

function utf8BytesToString(bytes) {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const value = bytes[i++];
    if (value < 0x80) {
      str += String.fromCharCode(value);
    } else if (value > 0xbf && value < 0xe0) {
      str += String.fromCharCode(((value & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (value > 0xdf && value < 0xf0) {
      str += String.fromCharCode(((value & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const code = (((value & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      str += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return str;
}

function hexToBytes(hex) {
  const bytes = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substring(c, c + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    let h = bytes[i].toString(16);
    if (h.length < 2) h = '0' + h;
    hex += h;
  }
  return hex;
}

function base64ToBytes(b64) {
  b64 = b64.replace(/=/g, '').replace(/[^A-Za-z0-9+/]/g, '');
  const len = b64.length;
  const bytes = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const c1 = b64Lookup[b64.charCodeAt(i)];
    const c2 = b64Lookup[b64.charCodeAt(i + 1)];
    const c3 = i + 2 < len ? b64Lookup[b64.charCodeAt(i + 2)] : 0;
    const c4 = i + 3 < len ? b64Lookup[b64.charCodeAt(i + 3)] : 0;

    bytes[p++] = (c1 << 2) | (c2 >> 4);
    if (i + 2 < len) {
      bytes[p++] = ((c2 & 15) << 4) | (c3 >> 2);
    }
    if (i + 3 < len) {
      bytes[p++] = ((c3 & 3) << 6) | c4;
    }
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
    const c3 = ((b2 & 15) << 2) | (b3 >> 6);
    const c4 = b3 & 63;

    result += b64Chars.charAt(c1) + b64Chars.charAt(c2);
    result += i + 1 < len ? b64Chars.charAt(c3) : '=';
    result += i + 2 < len ? b64Chars.charAt(c4) : '=';
  }
  return result;
}

class Buffer extends Uint8Array {
  constructor(...args) {
    super(...args);
    Object.setPrototypeOf(this, Buffer.prototype);
    this._isBuffer = true;
  }

  static from(data, encoding = 'utf8') {
    if (typeof data === 'string') {
      const lowerEnc = encoding.toLowerCase();
      if (lowerEnc === 'hex') {
        return new Buffer(hexToBytes(data));
      } else if (lowerEnc === 'base64') {
        return new Buffer(base64ToBytes(data));
      } else {
        return new Buffer(stringToUtf8Bytes(data));
      }
    }
    if (data instanceof ArrayBuffer) {
      return new Buffer(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Buffer(data.buffer, data.byteOffset, data.byteLength);
    }
    return new Buffer(data);
  }

  static alloc(size) {
    return new Buffer(size);
  }

  static allocUnsafe(size) {
    return new Buffer(size);
  }

  static isBuffer(obj) {
    return obj instanceof Buffer || (obj && (obj.constructor === Buffer || obj._isBuffer === true));
  }

  static isEncoding(encoding) {
    if (typeof encoding !== 'string') return false;
    const lower = encoding.toLowerCase();
    return lower === 'utf8' ||
           lower === 'utf-8' ||
           lower === 'hex' ||
           lower === 'base64' ||
           lower === 'ascii' ||
           lower === 'latin1' ||
           lower === 'binary' ||
           lower === 'utf16le' ||
           lower === 'ucs2';
  }

  static concat(list, totalLength) {
    if (!Array.isArray(list)) {
      throw new TypeError('"list" argument must be an Array of Buffers');
    }
    if (list.length === 0) {
      return Buffer.alloc(0);
    }
    if (totalLength === undefined) {
      totalLength = 0;
      for (let i = 0; i < list.length; i++) {
        totalLength += list[i].length;
      }
    }
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (let i = 0; i < list.length; i++) {
      const buf = list[i];
      const len = Math.min(buf.length, totalLength - offset);
      if (len > 0) {
        result.set(buf, offset);
        offset += len;
      }
      if (offset >= totalLength) {
        break;
      }
    }
    return result;
  }

  toString(encoding = 'utf8') {
    const lowerEnc = encoding.toLowerCase();
    if (lowerEnc === 'hex') {
      return bytesToHex(this);
    } else if (lowerEnc === 'base64') {
      return bytesToBase64(this);
    } else {
      return utf8BytesToString(this);
    }
  }
}

module.exports = {
  Buffer: Buffer,
  kMaxLength: 2147483647
};

globalThis.Buffer = Buffer;
