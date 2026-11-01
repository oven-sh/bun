// node:crypto's webcrypto is the object of the global `crypto`: what is copied onto the one is read off the other.
const other = require("node:crypto").webcrypto;
Object.assign(other, { number: 3, text: "abc", list: [1, 2, 3], object: { inner: 7 } });
function read() {
  return [crypto.number, crypto.text.length, crypto.list.length, crypto.object.inner, typeof crypto.subtle].join();
}
console.log(read(), other === crypto, other === globalThis.crypto, Object.keys(crypto).join());
