// Seeded, grammar-aware random inputs: lines built from directive templates with hostile white space.
let seed = 0x9e3779b9;
function rnd(n: number): number {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed % n;
}
const pick = <T>(a: T[]): T => a[rnd(a.length)];
const goodWs = ["", "", " ", " ", "  ", "\t", "\f", "\r", " \t "];
const badWs = ["\v", "\u00a0", "\u0085", "\ufeff", "\u2028", "\u2029", "\u3000", "\u200b", "\u1680", "\u2003"];
const ws = () => (rnd(12) === 0 ? pick(badWs) : pick(goodWs));
const names = ["filename", "Filename", "FILENAME", "fileName", "link", "Link", "symlink", "Symlink", "currentDirectory", "currentdirectory", "strict", "target", "Target", "noEmit", "emitThisFile", "noOpen", "declaration", "module", "__proto__", "a1_b", "é", "x.y", ""];
const fileNames = ["a.ts", "b.ts", "/a.ts", "/src/b.tsx", "c:/x/d.ts", "c:\\x\\e.ts", "tsconfig.json", "/tsconfig.json", "/p/jsconfig.json", "TSConfig.JSON", "/x/tsconfig.json/", "c:\\p\\JSCONFIG.json\\", "TSCONF\u0130G.JSON", "file:///c:/tsconfig.json", "//srv/tsconfig.json", "é.ts", "\u{1f600}.ts", "", "a b.ts", "a->b.ts", "/", "c:/", "c:", "^/untitled/tsconfig.json", "http://h/tsconfig.json", "http://tsconfig.json", "//tsconfig.json"];
const values = ["true", "false", "es5", "es5, es2015", "true;", "true ;", ";", ";;", "", "a -> b", "/a -> /b -> /c", "->", "x // c", "esnext\u0085", "\ufeffv", "\u00a0v\u3000", "v\u200b", "/x.ts, /y.ts,, ", "/", "/b;", "\u0000", "v\tw"];
const contents = ["var x;", "  ", " ", "\t", "x", "// plain comment", "/* block */", "/* open", "close */", "*/ var z;", "#!/bin/sh", "<<<<<<< HEAD", "=======", ">>>>>>> other", "||||||| base", "<<<<<<<", "======= ", "<<<<<< x", "  <<<<<<< HEAD", " <<<<<<< HEAD", "\u00a0<<<<<<< HEAD", "\u00a0\u00a0<<<<<<< H", "\u2028<<<<<<< HEAD", "é\u{1f600}", "\u00a0", "\ufeff", "\u0085", "\u200b", "\u180e", "*", " * doc", "/", "///", "//", "//// var a;", "@strict: true", ": true", "-> x", "=", "<", ">>", "||", "\u0000"];
const eols = ["\n", "\n", "\n", "\r\n", "\r\n", "\r", "\u2028", "\u2029", "\r\r\n", "\n\n", "\u0085"];
function directive(): string {
  const slashes = rnd(15) === 0 ? pick(["/", "///", "////", " //", "/ /"]) : "//";
  const name = pick(names);
  let value: string;
  const lower = name.toLowerCase();
  if (lower === "filename") value = pick(fileNames);
  else if (lower === "link") value = rnd(4) === 0 ? pick(values) : pick(fileNames) + ws() + "->" + ws() + pick(fileNames);
  else value = pick(values);
  const colon = rnd(20) === 0 ? "" : ":";
  return slashes + ws() + "@" + name + ws() + colon + ws() + value + (rnd(6) === 0 ? ws() : "");
}
const count = Number(process.argv[3] ?? "20000");
const out: any[] = [];
for (let i = 0; i < count; i++) {
  const n = rnd(14);
  let s = "";
  for (let k = 0; k < n; k++) {
    const kind = rnd(10);
    if (kind < 5) s += directive();
    else if (kind < 9) s += pick(contents);
    if (k + 1 < n || rnd(2) === 0) s += pick(eols);
  }
  const mode = rnd(16);
  let bytes: Buffer;
  if (mode === 0) bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, "utf8")]);
  else if (mode === 1) bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);
  else if (mode === 2) bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, "utf16le").swap16()]);
  else if (mode === 3) bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le"), Buffer.from([0x2f])]);
  else bytes = Buffer.from(s, "utf8");
  out.push({ name: "fuzz2 " + i, fileName: pick(["/cases/compiler/fuzz.ts", "rel\\dir\\fuzz.tsx", "fuzz.ts", "/cases/conformance/a/b/c.d.ts", "c:/t/tsconfig.ts/"]), bytes: bytes.toString("base64"), allowImplicitFirstFile: rnd(8) === 0 });
}
await Bun.write(process.argv[2], JSON.stringify(out));
console.error("fuzz inputs:", out.length);
