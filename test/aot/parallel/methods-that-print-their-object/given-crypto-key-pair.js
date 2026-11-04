const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
console.log(Object.keys(pair), pair.publicKey.type);
console.log(pair.publicKey);
