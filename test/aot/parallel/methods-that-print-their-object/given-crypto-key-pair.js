// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
console.log(Object.keys(pair), pair.publicKey.type);
console.log(pair.publicKey);
