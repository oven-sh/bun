// A message quotes what Bun prints: a name has its characters escaped, a text that is a key stays a text, a regular expression is printed as it is written.
const say = run => { try { run(); } catch (error) { console.log(JSON.stringify(error.message)); } };
const o = {};
say(() => o.nothing({ 字: 1, "é": 2, é: 3, "字": 4, a: 5, "b": 6 }));
say(() => o.nothing(/字é😀/u));
say(() => o.nothing(/a/g, /é/));
