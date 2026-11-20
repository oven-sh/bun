function run(words: Uint16Array, bytes: Uint8Array): string { for (let i = 0; i < words.length; i++) words[i] = bytes[i + 1]; return bytes.join(); }
let s = ""; for (let r = 0; r < 200; r++) { const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8); s = run(new Uint16Array(bytes.buffer), bytes); } console.log(s);
