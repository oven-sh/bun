// Bun.stdin, Bun.stdout and Bun.stderr are blobs that the realm makes once and keeps.
const say = (...values: unknown[]) => console.log(...values);
say(Bun.stdout === Bun.stdout, Bun.stdout === (Bun.stderr as unknown), Bun.stdout instanceof Blob, Bun.stdin instanceof Blob, Object.getPrototypeOf(Bun.stderr) === Blob.prototype, typeof Bun.stdout.size, typeof Bun.stdout.type);
(Bun.stdout as any).marker = () => "a function put on the kept blob"; say((Bun.stdout as any).marker(), Object.keys(Bun.stdout).join());
const writer = Bun.stdout.writer(); say(typeof writer.write("written through a writer\n"), typeof writer.flush());
await Bun.write(Bun.stdout, "written by Bun.write\n");
say(typeof Bun.stdin.stream, typeof Bun.stdin.text, (Bun.stderr as any).name, (Bun.stdout as any).nothing);
(Bun as any).stdout = { replaced: () => "replaced" }; say((Bun.stdout as any).replaced?.() ?? "Bun.stdout cannot be replaced");
