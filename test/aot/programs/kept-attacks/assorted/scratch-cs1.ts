// Assorted, one probe of many. It prints what plain Bun prints.
console.log(typeof crypto, typeof crypto.subtle, typeof crypto.getRandomValues, typeof crypto.randomUUID, typeof globalThis.SubtleCrypto, Object.keys(Object.getPrototypeOf(crypto)).join());
