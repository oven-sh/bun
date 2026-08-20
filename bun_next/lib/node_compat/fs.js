const fsBinding = internalBinding('fs');

module.exports = {
  readFileSync: (path, options) => {
    // Node supporte des options (encoding), ici on simplifie
    return fsBinding.readFileUtf8(path);
  },
  writeFileSync: (path, data) => {
    return fsBinding.writeFileUtf8(path, data);
  },
  mkdirSync: (path) => {
    return fsBinding.mkdir(path);
  },
  unlinkSync: (path) => {
    return fsBinding.unlink(path);
  },
  // Async versions
  readFile: (path, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
    }
    try {
      const data = fsBinding.readFileUtf8(path);
      if (callback) callback(null, data);
    } catch (e) {
      if (callback) callback(e);
    }
  }
};
