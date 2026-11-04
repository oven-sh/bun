// the environment of bun beside it
console.log(process.env === Bun.env);
process.env.KEPT_IN_ITS_WORD = "one";
console.log(Bun.env.KEPT_IN_ITS_WORD, import.meta.env.KEPT_IN_ITS_WORD);
Bun.env.KEPT_IN_ITS_WORD = "two";
console.log(process.env.KEPT_IN_ITS_WORD);
delete process.env.KEPT_IN_ITS_WORD;
console.log(Bun.env.KEPT_IN_ITS_WORD, "KEPT_IN_ITS_WORD" in process.env);
