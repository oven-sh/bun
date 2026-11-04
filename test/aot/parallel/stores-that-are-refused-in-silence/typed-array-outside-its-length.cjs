const bytes = new Uint8Array(2);
bytes[5] = 1; bytes[-1] = 2; bytes[1] = 3;
console.log(bytes[5], bytes[-1], bytes[1], bytes.length);
