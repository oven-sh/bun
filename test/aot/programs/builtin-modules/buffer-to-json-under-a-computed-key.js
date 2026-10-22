// What a child process has printed is a Buffer that native code makes. This program calls Buffer.prototype.toJSON, which is written in JavaScript, under a key that nobody can name.
const { stdout } = Bun.spawnSync(["echo", "printed"]);
const key = ["to", process.argv.length > 100 ? "String" : "JSON"].join("");
console.log(stdout[key]().type);
