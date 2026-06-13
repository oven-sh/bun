const EventEmitter = require('node:events');

class Process extends EventEmitter {
  constructor() {
    super();
    this.platform = 'win32';
    this.version = 'v26.0.0';
    this.arch = 'x64';
    this.pid = 1;
    this.env = { NODE_ENV: 'development' };
    this.stdout = { write: (data) => console.log(data) };
  }

  cwd() { return '.'; }

  nextTick(fn, ...args) {
    setTimeout(() => fn(...args), 0);
  }

  exit(code = 0) {
    sendToElixir({ type: 'process_exit', code: code });
    this.emit('exit', code);
  }
}

const process = new Process();
module.exports = process;
globalThis.process = process;
