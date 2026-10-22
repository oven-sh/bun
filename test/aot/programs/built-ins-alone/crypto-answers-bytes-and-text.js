const bytes = new Uint8Array(4);
console.log(crypto.getRandomValues(bytes) === bytes, crypto.randomUUID().length, typeof crypto.subtle.digest);
console.log((await crypto.subtle.digest("SHA-256", new Uint8Array([1]))).byteLength + 1);
