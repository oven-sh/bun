var WriteStream;

function load() {
  return require("internal/fs/WriteStream").WriteStream;
}

export default {
  WriteStreamPropertyDescriptor: {
    get() {
      return (WriteStream ??= load());
    },
    set() {},
    enumerable: true,
  },
  createWriteStream(path, options) {
    return new (WriteStream ??= load())(path, options);
  },
};
