onmessage = function (event) {
  this.postMessage([this === self, event.target === self, event.currentTarget === globalThis].join());
};
