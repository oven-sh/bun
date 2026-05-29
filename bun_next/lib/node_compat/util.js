function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  }
}

const types = {
  isDate: (object) => object instanceof Date,
  isRegExp: (object) => object instanceof RegExp,
  isPromise: (object) => object instanceof Promise,
  isMap: (object) => object instanceof Map,
  isSet: (object) => object instanceof Set,
  isWeakMap: (object) => object instanceof WeakMap,
  isWeakSet: (object) => object instanceof WeakSet,
  isArrayBuffer: (object) => object instanceof ArrayBuffer,
  isTypedArray: (object) => ArrayBuffer.isView(object) && !(object instanceof DataView),
  isUint8Array: (object) => object instanceof Uint8Array,
  isAnyArrayBuffer: (object) => object instanceof ArrayBuffer || (object && object.buffer instanceof ArrayBuffer)
};

module.exports = {
  inherits: inherits,
  types: types,
  promisify: (fn) => {
    return (...args) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
  inspect: (obj) => {
    if (obj === null) return 'null';
    if (typeof obj === 'undefined') return 'undefined';
    if (typeof obj === 'string') return `'${obj}'`;
    if (typeof obj === 'number' || typeof obj === 'boolean') return obj.toString();
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return "[Object]";
    }
  },
  format: (f, ...args) => {
    let i = 0;
    return f.replace(/%[sdj%]/g, (x) => {
      if (x === '%%') return '%';
      if (i >= args.length) return x;
      const arg = args[i++];
      if (x === '%s') return String(arg);
      if (x === '%d') return Number(arg);
      if (x === '%j') return JSON.stringify(arg);
      return x;
    });
  }
};
