Object.defineProperty(crypto, "got", { get() { return 7; }, configurable: true });
function read() { return require("node:crypto").webcrypto.got; }
console.log(String(read()));
