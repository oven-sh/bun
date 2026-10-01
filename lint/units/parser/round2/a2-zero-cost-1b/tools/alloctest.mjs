// 200 parses of one small source per loader: how many mimalloc pages does a parse take
const kind = process.argv[2] ?? "js";
const rep = f => Array.from({ length: 20 }, (_, i) => f(i)).join("");
const sources = {
  js: rep(i => `function f${i}(a, b) { return a + b }\nconst g${i} = function (x) { return x };\nclass A${i} { m(p) { return p } }\n`),
  jsnofn: rep(i => `let a${i} = 1 + 2;\nlet b${i} = [a${i}, a${i} * 2, { c: a${i} }];\nfoo.bar(b${i});\n`),
  ts: rep(i => `function f${i}(a: number, b: number): number { return a + b }\nconst g${i} = function (x: string) { return x };\nclass A${i} { m(p: A${i}) { return p } }\n`),
};
const t = new Bun.Transpiler({ loader: kind === "ts" ? "ts" : "js" });
let n = 0;
for (let i = 0; i < 200; i++) n += t.transformSync(sources[kind]).length;
console.log(kind, n);
