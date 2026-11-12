const proc = Bun.spawn({ cmd: ["head", "-c", "1073741824", "/dev/zero"], stdout: "pipe" });
const text = await proc.stdout.text();
console.log(JSON.stringify({ length: text.length }));
