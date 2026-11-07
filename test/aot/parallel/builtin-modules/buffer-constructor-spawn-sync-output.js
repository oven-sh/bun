// What a child process has printed is a Buffer that native code makes. This program reaches Buffer.from, which is written in JavaScript, only through the `constructor` of that value.
const { stdout } = Bun.spawnSync(["echo", "printed"]);
console.log(stdout.constructor.from("abc").length, stdout.constructor.isBuffer(stdout));
