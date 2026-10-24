// Native code puts `subtle` on Crypto.prototype at the first read of the global `crypto`, after the prototype object was made. The program names the member, so the build counts on it, and it is there all the same: an accessor that answers the one SubtleCrypto.
const prototype = Object.getPrototypeOf(crypto);
const descriptor = Object.getOwnPropertyDescriptor(prototype, "subtle")!;
console.log(typeof crypto.subtle, String(crypto.subtle), crypto.subtle === crypto.subtle, crypto.subtle instanceof SubtleCrypto);
console.log(Object.keys(prototype).join(), "subtle" in crypto, Object.hasOwn(crypto, "subtle"), typeof descriptor.get, descriptor.enumerable, descriptor.configurable);
const digest = await crypto.subtle.digest("SHA-256", new Uint8Array([1, 2, 3]));
console.log(digest.byteLength, Buffer.from(digest).toString("hex").slice(0, 16));
