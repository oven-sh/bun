// The global Bun, by constant names: files, hashing, compression, globs, versions, escaping, equality, inspection, widths, spawning, sleeping, TOML, paths, colors and the environment.
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), "library-modules-" + process.pid + ".txt");
console.log(await Bun.write(file, "written by Bun"), await Bun.file(file).text(), Bun.file(file).size, await Bun.file(file).exists(), Bun.file(file).type, (await Bun.file(file).arrayBuffer()).byteLength, (await Bun.file(file).bytes()).length);
const writer = Bun.file(file).writer();
writer.write("one ");
writer.write("two");
await writer.end();
console.log(await Bun.file(file).text(), await Bun.file(file).slice(4).text());
await Bun.file(file).delete();
console.log(await Bun.file(file).exists(), await Bun.file(file).text().catch(error => error.code));

console.log(Bun.hash("abc").toString(16), Bun.hash.crc32("abc"), Bun.hash.adler32("abc"), Bun.hash.wyhash("abc", 1n).toString(16), new Bun.CryptoHasher("sha256").update("abc").digest("hex").slice(0, 16), Bun.SHA1.hash("abc", "hex").slice(0, 8), Bun.CryptoHasher.algorithms.includes("md5"));
console.log(new TextDecoder().decode(Bun.gunzipSync(Bun.gzipSync("zipped"))), new TextDecoder().decode(Bun.inflateSync(Bun.deflateSync("deflated"))), new TextDecoder().decode(Bun.zstdDecompressSync(Bun.zstdCompressSync("zstd"))));
console.log(new Bun.Glob("*.{js,ts}").match("a.ts"), new Bun.Glob("**/x/*.js").match("a/b/x/c.js"), new Bun.Glob("a?c").match("abd"));
console.log(Bun.semver.satisfies("1.2.3", "^1.2.0"), Bun.semver.satisfies("2.0.0", "^1.2.0"), Bun.semver.order("1.0.0", "1.0.1"));
console.log(Bun.escapeHTML('<a href="x">&</a>'), Bun.deepEquals({ a: [1] }, { a: [1] }), Bun.deepEquals({ a: 1 }, { a: 1, b: undefined }, true), Bun.deepMatch({ a: 1 }, { a: 1, b: 2 }), Bun.stringWidth("日本"), Bun.stringWidth("\u001b[31mred\u001b[0m"), Bun.stripANSI("\u001b[31mred\u001b[0m"));
console.log(Bun.inspect({ a: new Map([[1, 2]]) }), Bun.inspect("text"), Bun.inspect.table([{ a: 1 }]).split("\n").length, typeof Bun.inspect.custom);
console.log(JSON.stringify(Bun.TOML.parse('a = 1\n[b]\nc = "d"')), Bun.fileURLToPath("file:///a/b"), Bun.pathToFileURL("/a b").href, Bun.color("red", "hex"), Bun.color("#00f", "css"), JSON.stringify(Bun.color("rgb(1,2,3)", "{rgb}")));
const child = Bun.spawn(["sh", "-c", "cat; echo err >&2; exit 3"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
child.stdin.write("piped in");
child.stdin.end();
console.log(await child.stdout.text(), (await child.stderr.text()).trim(), await child.exited, child.exitCode, child.signalCode, child.killed, typeof child.pid);
const sync = Bun.spawnSync(["echo", "sync"]);
console.log(sync.stdout.toString().trim(), sync.exitCode, sync.success, Bun.which("sh") !== null, Bun.which("no-such-program-anywhere"));
console.log((await Bun.$`echo shell ${"with a space"}`.text()).trim(), (await Bun.$`exit 2`.nothrow().quiet()).exitCode);
const before = Bun.nanoseconds();
await Bun.sleep(2);
Bun.sleepSync(1);
console.log(Bun.nanoseconds() > before, typeof Bun.version, typeof Bun.revision, Bun.env === process.env, typeof Bun.main, Bun.isMainThread, typeof Bun.gc(true), Bun.peek(Promise.resolve(5)), Bun.peek.status(new Promise(() => {})));
console.log(await Bun.readableStreamToText(new Response("stream").body), (await Bun.readableStreamToArray(new ReadableStream({ start(c) { c.enqueue(1); c.close(); } }))).join(), Bun.concatArrayBuffers([new Uint8Array([1]), new Uint8Array([2])]).byteLength, Bun.indexOfLine(new TextEncoder().encode("a\nb"), 0), /^[0-9a-f-]{36}$/.test(Bun.randomUUIDv7()));
