// The members of a web interface whose prototype no executable locks are redefined, deleted and put back where the build reads the object and the name: each read and call answers as plain Bun does. Crypto.prototype has `subtle` before anything reads `crypto`.
const subtle = Object.getOwnPropertyDescriptor(Crypto.prototype, "subtle");
console.log("subtle before crypto is read:", typeof subtle?.get, subtle?.configurable, subtle?.enumerable);
console.log("subtle:", typeof crypto.subtle.digest);
Object.defineProperty(Crypto.prototype, "subtle", { get: () => "replaced", configurable: true });
console.log("subtle replaced:", crypto.subtle);
console.log("subtle deleted:", delete Crypto.prototype.subtle, crypto.subtle, "subtle" in crypto);
Object.defineProperty(Crypto.prototype, "subtle", subtle);
console.log("subtle put back:", typeof crypto.subtle.digest);

const decoder = new TextDecoder("utf-16le", { fatal: true });
const fatal = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "fatal");
const encoding = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "encoding");
console.log("fatal, encoding:", decoder.fatal, decoder.encoding);
Object.defineProperty(TextDecoder.prototype, "fatal", { get: () => "replaced", configurable: true });
Object.defineProperty(TextDecoder.prototype, "encoding", { value: "a value", configurable: true });
console.log("fatal, encoding replaced:", decoder.fatal, decoder.encoding, new TextDecoder().encoding);
console.log("fatal, encoding deleted:", delete TextDecoder.prototype.fatal, delete TextDecoder.prototype.encoding, decoder.fatal, decoder.encoding);
Object.defineProperty(TextDecoder.prototype, "fatal", fatal);
Object.defineProperty(TextDecoder.prototype, "encoding", encoding);
console.log("fatal, encoding put back:", decoder.fatal, decoder.encoding, new TextDecoder().encoding);

const randomUUID = Object.getOwnPropertyDescriptor(Crypto.prototype, "randomUUID");
console.log("randomUUID:", crypto.randomUUID().length);
Object.defineProperty(Crypto.prototype, "randomUUID", { value: () => "wrapped", writable: true, configurable: true });
console.log("randomUUID wrapped:", crypto.randomUUID());
console.log("randomUUID deleted:", delete Crypto.prototype.randomUUID, typeof crypto.randomUUID);
Object.defineProperty(Crypto.prototype, "randomUUID", randomUUID);
console.log("randomUUID put back:", crypto.randomUUID().length);
