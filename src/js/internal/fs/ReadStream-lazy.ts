var ReadStream;
function load() {
  return require("internal/fs/ReadStream").ReadStream;
}

export default {
  ReadStreamPropertyDescriptor: {
    enumerable: true,

    get() {
      return (ReadStream ??= load());
    },

    set() {},
  },

  createReadStream(path, options) {
    return new (ReadStream ??= load())(path, options);
  },
};
