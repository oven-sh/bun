// What a child process has printed is a Buffer that native code makes, and Buffer.prototype.toJSON is written in JavaScript. This program never names Buffer.
const { stdout } = Bun.spawnSync(["echo", "printed"]);
console.log(stdout.toJSON().type, JSON.stringify(stdout).slice(0, 16), typeof stdout.parent.byteLength, typeof stdout.offset);
