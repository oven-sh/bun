// Parts of Bun that carry a lot of code with them, each by a constant name: HTMLRewriter, cookies, YAML, passwords with a low cost, CSRF tokens, the transpiler, the router of a folder, an ArrayBufferSink and a heap snapshot.
const rewritten = new HTMLRewriter()
  .on("a[href]", { element(element) { element.setAttribute("href", element.getAttribute("href").replace("http:", "https:")); element.append("!", { html: false }); } })
  .on("p", { text(chunk) { if (chunk.text) chunk.replace(chunk.text.toUpperCase()); } })
  .on("script", { element(element) { element.remove(); } })
  .transform(new Response('<p>text</p><a href="http://x.example">link</a><script>bad()</script>'));
console.log(await rewritten.text());

const cookies = new Bun.CookieMap("a=1; b=two");
cookies.set("c", "3", { httpOnly: true, path: "/", maxAge: 60 });
cookies.delete("a");
console.log(cookies.get("b"), cookies.has("a"), cookies.size, cookies.toSetCookieHeaders().sort().join(" | "));
const cookie = Bun.Cookie.parse("id=7; Path=/x; Secure; SameSite=Strict");
console.log(cookie.name, cookie.value, cookie.path, cookie.secure, cookie.sameSite, cookie.isExpired(), new Bun.Cookie("n", "v").serialize());

console.log(JSON.stringify(Bun.YAML.parse("a: 1\nb:\n  - x\n  - y: true\n")), Bun.YAML.stringify({ k: [1, "s"] }).trim().replaceAll("\n", "|"));
const hashed = Bun.password.hashSync("secret", { algorithm: "bcrypt", cost: 4 });
console.log(hashed.startsWith("$2"), Bun.password.verifySync("secret", hashed), Bun.password.verifySync("wrong", hashed), await Bun.password.verify("secret", await Bun.password.hash("secret", { algorithm: "argon2id", memoryCost: 8, timeCost: 1 })));
const token = Bun.CSRF.generate("key");
console.log(typeof token, Bun.CSRF.verify(token, { secret: "key" }), Bun.CSRF.verify(token, { secret: "other" }));

const sink = new Bun.ArrayBufferSink();
sink.start({ asUint8Array: true });
sink.write("ab");
sink.write(new Uint8Array([99]));
console.log(new TextDecoder().decode(sink.end()));
const snapshot = Bun.generateHeapSnapshot();
console.log(typeof snapshot.version, Array.isArray(snapshot.nodes), snapshot.nodeClassNames.length > 0);
console.log(Bun.stringWidth("á"), Bun.escapeHTML(5), Bun.inspect(new Bun.CookieMap("q=1")).includes("q"), typeof Bun.FileSystemRouter, typeof Bun.Transpiler, typeof Bun.build, typeof Bun.plugin, typeof Bun.sql, typeof Bun.redis, typeof Bun.s3, typeof Bun.SQL, typeof Bun.S3Client, typeof Bun.RedisClient);
