// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = await crypto.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]);
console.log(key.type);
console.log(structuredClone({ inner: key }));
