const table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
const codec = { crc(seed, buf) { let c = ~seed >>> 0; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8); return ~c >>> 0; } };
console.log(codec.crc(0, Buffer.from([1, 2, 3])), codec.crc(0, Buffer.from("123456789")).toString(16));
