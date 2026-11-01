// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
console.log(await crypto.subtle.importKey("raw", new Uint8Array(16), "AES-GCM", true, ["encrypt"]));
