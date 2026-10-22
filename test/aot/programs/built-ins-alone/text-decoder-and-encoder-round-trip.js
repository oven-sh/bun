const bytes = new TextEncoder().encode("héllo");
console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[1] + 1, new TextDecoder().decode(bytes).length);
