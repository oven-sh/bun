const util = { hex(prefix, b) { let s = prefix; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; } };
console.log(util.hex("0x", Buffer.from([1, 171, 255])));
