// Bun prints nothing but ASCII, and a message quotes what it prints: a name has its characters escaped, a text that is a key stays a text, a regular expression has the units of UTF-16.
const say = run => { try { run(); } catch (error) { console.log(JSON.stringify(error.message)); } };
const o = {};
say(() => o.nothing({ 字: 1, "é": 2, é: 3, "字": 4, a: 5, "b": 6 }));
say(() => o.nothing(/字é😀/u));
say(() => o.nothing(/a/g, /é/));
