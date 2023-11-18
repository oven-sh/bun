var FSWatcher;

var load = () => {
  FSWatcher = require("internal/fs/FSWatcher").FSWatcher;
  load = () => {};
  return FSWatcher;
};

export default {
  FSWatcherPropertyDescriptor: {
    enumerable: true,
    get() {
      load();
      return FSWatcher;
    },
    set() {},
  },
  watch: function watch(...args) {
    load();
    return new FSWatcher(...args);
  },
};
