const assert = require('node:assert');

module.exports = {
  mustCall: function(fn, expected = 1) {
    let actual = 0;
    return function(...args) {
      actual++;
      return fn(...args);
    };
  },
  spawnPromisified: (cmd, args) => {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = __elixir_spawn(cmd, args);
      child.on('stdout', (data) => stdout += data);
      child.on('stderr', (data) => stderr += data);
      child.on('close', (code) => {
        resolve({ code, signal: null, stdout, stderr });
      });
    });
  },
  platform: process.platform,
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isOSX: process.platform === 'darwin',
};
