// Generates the vectors that the Go ground truth and the Rust prototype both read.
import fs from "node:fs";
let seed = 0x2f6e2b1;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = n => Math.floor(rnd() * n);
const pick = a => a[ri(a.length)];
const hex = b => (b.length === 0 ? "-" : Buffer.from(b).toString("hex"));
const B = s => Buffer.from(s, "utf8");
const out = [];
const files = [
  ["/src/a.ts", B("let \u{1F600}\u00e9 = 1;\r\nlet y: { a: number } = { a: \"\" };\u2028z\u2029w\rq\n\nend")],
  ["/src/b.ts", B("const x: number = \"s\";\n")],
  ["/src/dir/c.ts", B("a\nb\nc")],
  ["/other/d.ts", B("x = 1\n")],
  ["/src/e.ts", Buffer.concat([B("ab"), Buffer.from([0xff, 0xfe]), B("c\n"), Buffer.from([0xe2, 0x82]), B("d\r"), Buffer.from([0xed, 0xa0, 0x80]), B("e\n"), Buffer.from([0xf0, 0x9f, 0x98]), B("f")])],
  ["/src/empty.ts", B("")],
];
for (const [n, t] of files) out.push(`F ${hex(B(n))} ${hex(t)}`);
for (let f = 0; f < files.length; f++) for (let p = 0; p <= files[f][1].length; p++) out.push(`LINECOL ${f} ${p}`);
const msgs = [[1003, 0], [2300, 1], [2322, 2], [2326, 1], [2741, 3], [2339, 2], [2728, 1], [6203, 1], [6204, 0], [6217, 1], [2554, 2], [2304, 1], [2345, 2]];
const byArgs = n => msgs.filter(m => m[1] === n);
const strArgs = [B("a"), B("b"), B("string"), B("number"), B("{ a: string; }"), B(""), B("\u00e9"), B("\u65e5\u672c"), Buffer.from([0xff]), Buffer.from([0x61, 0xc3]), Buffer.from([0xe2, 0x82, 0x41, 0xff, 0xfe]), B("{0}"), B("{1}"), B("A"), B("aa")];
function arg() { if (rnd() < 0.15) return "i:" + pick([0, 3, -1, 12, 100]); return "s:" + hex(pick(strArgs.slice(0, rnd() < 0.7 ? 4 : strArgs.length))); }
let caseNo = 0;
function makeCase(kind) {
  const lines = [];
  const diags = [];
  function newDiag(fileChoices, depth) {
    const file = pick(fileChoices);
    let pos = -1, end = -1;
    if (file >= 0) { const len = files[file][1].length; pos = Math.min(len, pick([0, 1, 2, 5, 9])); end = Math.min(len, pos + pick([0, 1, 2])); }
    else if (rnd() < 0.3) { pos = 0; end = 0; }
    if (rnd() < 0.06) { const id = diags.length; diags.push({}); lines.push(`A ${hex(B(pick(["internal one", "internal two {0}", "x"])))} ${file} ${pos} ${end}`); return id; }
    const [code, n] = pick(msgs);
    const args = []; for (let i = 0; i < n; i++) args.push(arg());
    const cat = rnd() < 0.1 ? pick([0, 1, 2, 3]) : -1;
    const id = diags.length; diags.push({ code, args });
    lines.push(`D ${file} ${pos} ${end} ${code} ${cat} ${rnd() < 0.1 ? 1 : 0} ${n}${args.length ? " " + args.join(" ") : ""}`);
    return id;
  }
  function decorate(id, fileChoices, depth) {
    if (depth < 3 && rnd() < (kind === "deep" ? 0.7 : 0.3)) { const k = 1 + ri(kind === "deep" ? 3 : 1); for (let i = 0; i < k; i++) { const c = newDiag(fileChoices, depth + 1); lines.push(`C ${id} ${c}`); decorate(c, fileChoices, depth + 1); } }
    if (depth < 2 && rnd() < 0.3) { const k = 1 + ri(3); for (let i = 0; i < k; i++) { const r = newDiag([0, 1, 2, 3, -1], depth + 1); lines.push(`R ${id} ${r}`); decorate(r, fileChoices, depth + 2); } }
  }
  function wrap(id) {
    const [code, n] = pick(msgs); const args = []; for (let i = 0; i < n; i++) args.push(arg());
    const nid = diags.length; diags.push({}); lines.push(`N ${id} ${code} ${n}${args.length ? " " + args.join(" ") : ""}`); return nid;
  }
  function cloneAs(id, cat) { const nid = diags.length; diags.push({}); lines.push(`CL ${id} ${cat}`); return nid; }
  const fileChoices = kind === "onefile" ? [0] : kind === "global" ? [-1] : [0, 0, 1, 2, 3, 4, -1];
  const nTop = kind === "big" ? 20 + ri(40) : 1 + ri(16);
  const top = [];
  for (let i = 0; i < nTop; i++) {
    if (top.length > 0 && rnd() < 0.15) { top.push(pick(top)); continue; }
    let id = newDiag(fileChoices, 0); decorate(id, fileChoices, 0);
    if (rnd() < 0.2) { id = wrap(id); if (rnd() < 0.3) id = wrap(id); }
    if (rnd() < 0.03) id = wrap(-1);
    top.push(id);
    if (rnd() < 0.1) top.push(cloneAs(id, pick([2, 2, 0, 3])));
  }
  out.push(`CASE ${kind}${caseNo++}`, ...lines, `TOP ${top.join(" ")}`, "END");
}
// Ties under CompareDiagnostics that print differently: same head, chains of one entry with the same args and another message.
function tieCase(n) {
  const lines = [], top = []; let id = 0;
  const filler = n - 6;
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = 0; i < n; i++) {
    const tie = i % Math.max(2, Math.floor(n / 6)) === 0;
    if (tie) {
      lines.push(`D 0 5 6 2322 -1 0 2 s:${hex(B("x"))} s:${hex(B("y"))}`); const head = id++;
      const code = pick([2326, 2300, 2728, 6203, 2304]);
      lines.push(`D 0 5 6 ${code} -1 0 1 s:${hex(B("a"))}`); const child = id++;
      lines.push(`C ${head} ${child}`); top.push(head);
    } else {
      lines.push(`D 0 ${ri(12)} ${12 + ri(3)} ${pick([2300, 2304])} -1 0 1 s:${hex(pick(strArgs.slice(0, 4)))}`); top.push(id++);
    }
  }
  out.push(`CASE tie${caseNo++}`, ...lines, `TOP ${top.join(" ")}`, "END");
}
const small = process.env.SMALL === "1";
for (let i = 0; i < (small ? 30 : 150); i++) makeCase("mixed");
for (let i = 0; i < (small ? 8 : 40); i++) makeCase("onefile");
for (let i = 0; i < (small ? 4 : 20); i++) makeCase("global");
for (let i = 0; i < (small ? 8 : 40); i++) makeCase("deep");
for (let i = 0; i < (small ? 6 : 40); i++) makeCase("big");
for (const n of small ? [8, 12, 13, 20, 50] : [8, 12, 13, 14, 20, 33, 50, 64, 100, 200]) for (let k = 0; k < (small ? 1 : 4); k++) tieCase(n);
for (const n of process.env.SMALL === "1" ? [0, 1, 2, 12, 13, 20, 50, 64, 129, 300] : [0, 1, 2, 7, 8, 12, 13, 20, 49, 50, 51, 64, 100, 127, 128, 129, 500, 1000, 4097]) for (const div of process.env.SMALL === "1" ? [1, 16] : [1, 2, 16, 1000000]) for (const shape of ["random", "sorted", "reversed", "fewvalues", "sawtooth", "almost", "organ"]) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(shape === "random" ? ri(n * 4 + 1) : shape === "sorted" ? i : shape === "reversed" ? n - i : shape === "fewvalues" ? ri(5) * 16 + ri(16) : shape === "sawtooth" ? (i % 17) * 3 : shape === "almost" ? (rnd() < 0.05 ? ri(n + 1) : i) : Math.min(i, n - i));
  out.push(`SORT ${div}${xs.length ? " " + xs.join(" ") : ""}`);
}
const rels = [["/src", 1, "/src/a.ts"], ["/src", 1, "/src/dir/c.ts"], ["/src", 1, "/other/d.ts"], ["/src", 1, "a.ts"], ["/src", 1, "./a.ts"], ["/src", 1, "../a.ts"], ["/src/", 1, "/src/a.ts"], ["/", 1, "/a.ts"], ["/", 1, "/src/a.ts"], ["", 1, "/src/a.ts"], ["/src", 1, "/SRC/a.ts"], ["/src", 0, "/SRC/a.ts"], ["/Src", 0, "/src/Dir/A.ts"], ["/a/b/c", 1, "/a/x/y.ts"], ["/a/b/c", 1, "/a/b/c"], ["/a/b/c", 1, "/a/b/c/"], ["/a/b/c", 1, "/a/b"], ["c:/src", 1, "c:/src/a.ts"], ["c:/src", 1, "d:/src/a.ts"], ["c:/src", 0, "C:/SRC/a.ts"], ["c:\\src", 1, "c:\\src\\a.ts"], ["/src", 1, "//server/share/a.ts"], ["/src", 1, "file:///src/a.ts"], ["/src", 1, "http://x/a.ts"], ["/src", 1, "/src//a.ts"], ["/src", 1, "/src/./a.ts"], ["/src", 1, "/src/x/../a.ts"], ["/src", 1, ""], ["/src", 1, "/"], ["/.src", 1, "/.src/tests/cases/compiler/a.ts"], ["/.src", 1, "/.lib/lib.d.ts"], ["/home/src/workspaces/project", 1, "/home/src/workspaces/project/a.ts"], ["/home/src/workspaces/project", 1, "/home/src/tslibs/TS/Lib/lib.d.ts"]];
for (const [c, s, p] of rels) out.push(`REL ${hex(B(c))} ${s} ${hex(B(p))}`);
const fmts = [
  ["'{0}' expected.", [")"]], ["'{0}' expected.", []], ["{0}{1}{0}", ["a", "b"]], ["{0}", ["{1}", "x"]], ["{{0}}", ["a"]], ["{ {0} as default }", ["n"]], ["'@param {object} {1}'", ["a", "b"]],
  ["{01}", ["a", "b"]], ["{0", ["a"]], ["0}", ["a"]], ["{}", ["a"]], ["{a}", ["a"]], ["{-1}", ["a"]], ["{+0}", ["a"]], ["{ 0}", ["a"]], ["{0 }", ["a"]], ["{1}", ["a"]], ["{2} {0}", ["a", "b"]],
  ["{99999999999999999999}", ["a"]], ["{18446744073709551616}", ["a"]], ["{9223372036854775807}", ["a"]], ["{00000000000000000000000}", ["a"]], ["{0}{", ["a"]], ["{0}}", ["a"]], ["{{0}", ["a"]], ["\u00e9{0}\u00e9", ["\u65e5"]], ["{\u0660}", ["a"]], ["{\uff10}", ["a"]],
  ["`{'}'}` {0}", ["a"]], ["{0}{1}{2}{3}{4}", ["a", "b", "c", "d", "e"]], ["", ["a"]], ["no placeholders", ["a"]],
];
for (const [t, a] of fmts) out.push(`FMT ${hex(B(t))} ${a.length}${a.length ? " " + a.map(x => hex(B(x))).join(" ") : ""}`);
const rawArgs = [[0xff], [0xff, 0xfe], [0x61, 0xff, 0x62], [0xc3], [0xc3, 0x28], [0xe2, 0x82], [0xe2, 0x82, 0x41], [0xe2, 0x28, 0xa1], [0xed, 0xa0, 0x80], [0xf0, 0x9f, 0x98], [0xf0, 0x9f, 0x98, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xef, 0xbf, 0xbd], [0xef, 0xbf, 0xbd, 0xff], [0xff, 0xef, 0xbf, 0xbd, 0xff], [0x80], [0x80, 0x80, 0x41, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80], [0xe2, 0x82, 0xac, 0xff, 0xe2, 0x82]];
for (const a of rawArgs) out.push(`FMT ${hex(B("<{0}>"))} 1 ${hex(Buffer.from(a))}`);
fs.writeFileSync(process.argv[2] ?? "vectors.txt", out.join("\n") + "\n");
console.log("lines", out.length, "cases", caseNo);
