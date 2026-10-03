// Generates test tarballs for the harness into /tmp/la-harness/cases.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { gzipSync } from "node:zlib";

const out = "/tmp/la-harness/cases";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const octal = (n, w) => n.toString(8).padStart(w - 1, "0") + "\0";
const fixsum = h => {
  h.fill(" ", 148, 156);
  let s = 0;
  for (let i = 0; i < 512; i++) s += h[i];
  h.write(octal(s, 8), 148);
  return h;
};
function header(name, size, type, { gnu = false, link = "", mode = 0o644 } = {}) {
  const b = Buffer.alloc(512, 0);
  b.write(name, 0, 100);
  b.write(octal(mode, 8), 100);
  b.write(octal(0, 8), 108);
  b.write(octal(0, 8), 116);
  b.write(octal(size, 12), 124);
  b.write(octal(1700000000, 12), 136);
  b.write(type, 156);
  if (link) b.write(link, 157, 100);
  if (gnu) b.write("ustar  \0", 257, "latin1");
  else {
    b.write("ustar\0", 257, "latin1");
    b.write("00", 263);
  }
  return fixsum(b);
}
const pad = n => Buffer.alloc((512 - (n % 512)) % 512);
const record = (k, v) => {
  const body = Buffer.concat([Buffer.from(` ${k}=`), Buffer.isBuffer(v) ? v : Buffer.from(String(v)), Buffer.from("\n")]);
  let len = body.length + 1;
  while (String(len).length + body.length !== len) len++;
  return Buffer.concat([Buffer.from(String(len)), body]);
};
function rnd(n, seed) {
  const b = Buffer.alloc(n);
  let s = createHash("sha256").update(String(seed)).digest();
  for (let o = 0; o < n; o += 32) {
    s.copy(b, o, 0, Math.min(32, n - o));
    s = createHash("sha256").update(s).digest();
  }
  return b;
}
const file = (name, body, opts) => [header(name, body.length, "0", opts), body, pad(body.length)];
const ext = (type, payload, name = "ext", opts) => [header(name, payload.length, type, opts), payload, pad(payload.length)];
const pax = (recs, type = "x") => ext(type, Buffer.concat(recs), "PaxHeaders.0/x");
const end = () => [Buffer.alloc(1024, 0)];
const pj = Buffer.from(JSON.stringify({ name: "p", version: "1.0.0", description: "d".repeat(150) }));
const pre = () => file("package/package.json", pj);
const post = () => file("package/after.txt", Buffer.from("after\n"));

function pax10(name, realSize, map, { comments = false, mapText, extra = [] } = {}) {
  const chunks = map.filter(([, l]) => l > 0).map(([o, l], i) => rnd(l, `${name}-${o}-${i}`));
  let text = mapText ?? `${map.length}\n` + map.map(([o, l]) => `${o}\n${l}\n`).join("");
  if (comments) text = `#comment line\n${map.length}\n#another\n` + map.map(([o, l]) => `${o}\n#c\n${l}\n`).join("");
  const mt = Buffer.from(text);
  const body = Buffer.concat([mt, pad(mt.length), ...chunks]);
  return [
    ...pax([record("GNU.sparse.major", 1), record("GNU.sparse.minor", 0), record("GNU.sparse.name", name), record("GNU.sparse.realsize", realSize), ...extra]),
    ...file("package/GNUSparseFile.0/" + name.split("/").pop(), body),
  ];
}
function gnuSparse(name, realSize, map, nExtForce) {
  const chunks = map.filter(([, l]) => l > 0).map(([o, l], i) => rnd(l, `${name}-${o}-${i}`));
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100);
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(body.length, 12), 124);
  h.write(octal(1700000000, 12), 136);
  h.write("S", 156);
  h.write("ustar  \0", 257, "latin1");
  map.slice(0, 4).forEach(([o, l], i) => {
    h.write(octal(o, 12), 386 + i * 24);
    h.write(octal(l, 12), 398 + i * 24);
  });
  let rest = map.slice(4);
  const blocks = [];
  const nExt = nExtForce ?? Math.ceil(rest.length / 21);
  if (nExt > 0) h[482] = 1;
  h.write(octal(realSize, 12), 483);
  fixsum(h);
  for (let e = 0; e < nExt; e++) {
    const x = Buffer.alloc(512, 0);
    const part = rest.slice(0, 21);
    rest = rest.slice(21);
    part.forEach(([o, l], i) => {
      x.write(octal(o, 12), i * 24);
      x.write(octal(l, 12), 12 + i * 24);
    });
    if (e < nExt - 1) x[504] = 1;
    blocks.push(x);
  }
  return [h, ...blocks, body, pad(body.length)];
}
const mapOf = (n, step, len, realSize) => {
  const m = [];
  for (let i = 0; i < n; i++) m.push([i * step, len]);
  if (realSize !== undefined) m.push([realSize, 0]);
  return m;
};
const P10 = [[0, 512], [299488, 512]];
const G1 = () => [...mapOf(5, 8192, 512), [299488, 512]];
const G2 = () => [...mapOf(27, 4096, 512), [299488, 512]];
const longdir = (c, n) => "package/" + `${c}/`.repeat(n);

const cases = {};
cases.plain = [...pre(), ...post(), ...end()];
cases.paxpath = [...pre(), ...pax([record("path", longdir("d", 80) + "long.txt"), record("mtime", "1700000001.5")]), ...file("package/short", Buffer.from("long body\n")), ...post(), ...end()];
cases.gnulong = [
  ...pre(),
  ...ext("L", Buffer.from(longdir("e", 90) + "gnu-long.txt\0"), "././@LongLink", { gnu: true }),
  ...file("package/short", Buffer.from("gnu long body\n"), { gnu: true }),
  ...ext("K", Buffer.from("target/" + "t/".repeat(90) + "x\0"), "././@LongLink", { gnu: true }),
  ...ext("L", Buffer.from(longdir("f", 90) + "link\0"), "././@LongLink", { gnu: true }),
  header("package/lnk", 0, "2", { gnu: true, link: "short-target" }),
  ...post(),
  ...end(),
];
// GNU long name in front of a ustar-magic hard link that declares a size
cases.longlink_ustar_hardlink = [
  ...pre(),
  ...file("package/orig.txt", Buffer.from("orig\n")),
  ...ext("L", Buffer.from(longdir("k", 90) + "hl\0"), "././@LongLink", { gnu: true }),
  header("package/hl", 5, "1", { link: "package/orig.txt" }),
  ...post(),
  ...end(),
];
cases.globalg = [...pax([record("comment", "abc123")], "g"), ...pre(), ...pax([record("comment", "second")], "g"), ...post(), ...end()];
cases.g_only = [...pax([record("comment", "abc123")], "g"), ...end()];
cases.volume = [...ext("V", Buffer.alloc(0), "volume-label", { gnu: true }), ...pre(), ...post(), ...end()];
cases.manyfiles = [...pre(), ...Array.from({ length: 40 }, (_, i) => file(`package/f${i}.js`, rnd(100 + i * 37, "mf" + i))).flat(), ...post(), ...end()];
cases.hardlink = [...pre(), ...file("package/orig.txt", Buffer.from("orig\n")), header("package/link.txt", 0, "1", { link: "package/orig.txt" }), ...post(), ...end()];
cases.dirs = [...pre(), header("package/sub/", 0, "5", { mode: 0o755 }), ...file("package/sub/x", rnd(10, "dx")), ...file("package/trailing/", Buffer.alloc(0)), ...post(), ...end()];
cases.pax_all = [
  ...pre(),
  ...pax([record("path", "package/renamed"), record("linkpath", "package/package.json"), record("uid", 4242), record("gid", 4343), record("uname", "u"), record("gname", "g"), record("atime", "1700000003.25"), record("ctime", "1700000004"), record("mtime", "1700000005.5"), record("size", 7), record("SCHILY.xattr.user.a", "b"), record("LIBARCHIVE.xattr.user.c", "ZA=="), record("hdrcharset", "BINARY"), record("comment", "c"), record("VENDOR.unknown", "zzz"), record("SCHILY.ino", 99), record("SCHILY.nlink", 2)]),
  ...file("package/x", Buffer.from("1234567")),
  ...post(),
  ...end(),
];
// a 0.0 map without numblocks: the offset/numbytes pairing reads stale state
cases.pax00_nonum = [...pre(), ...pax([record("GNU.sparse.size", 3000), record("GNU.sparse.offset", 0), record("GNU.sparse.numbytes", 8), record("GNU.sparse.offset", 2992), record("GNU.sparse.numbytes", 8)]), ...file("package/m.bin", rnd(16, "nn")), ...pax([record("GNU.sparse.size", 3000), record("GNU.sparse.numbytes", 8), record("GNU.sparse.offset", 100)]), ...file("package/n.bin", rnd(8, "nn2")), ...post(), ...end()];

cases.pax10 = [...pre(), ...pax10("package/m.bin", 300000, P10), ...post(), ...end()];
cases.pax10_first = [...pax10("package/m.bin", 300000, P10), ...post(), ...end()];
cases.pax10_last = [...pre(), ...pax10("package/m.bin", 300000, P10), ...end()];
cases.pax10_comments = [...pre(), ...pax10("package/m.bin", 300000, P10, { comments: true }), ...post(), ...end()];
cases.pax10_bigmap = [...pre(), ...pax10("package/m.bin", 400000, mapOf(300, 1024, 16, 400000)), ...post(), ...end()];
cases.pax10_hugemap = [...pre(), ...pax10("package/m.bin", 4000000, mapOf(12000, 256, 1, 4000000)), ...post(), ...end()];
cases.pax10_empty = [...pre(), ...pax10("package/m.bin", 300000, [[300000, 0]]), ...post(), ...end()];
cases.pax10_zero = [...pre(), ...pax10("package/m.bin", 0, [], { mapText: "0\n" }), ...post(), ...end()];
cases.pax10_trailhole = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512], [300000, 0]]), ...post(), ...end()];
cases.pax10_attrs = [...pre(), ...pax10("package/m.bin", 300000, P10, { extra: [record("mtime", "1700000009.25"), record("uid", 1234), record("uname", "someone"), record("SCHILY.xattr.user.k", "v")] }), ...post(), ...end()];
{
  const map = [];
  let text = "";
  let n = 36;
  for (;;) {
    map.length = 0;
    for (let i = 0; i < n; i++) map.push([i * 2048, 8]);
    text = `${map.length}\n` + map.map(([o, l]) => `${o}\n${l}\n`).join("");
    if (text.length >= 512 - 12) break;
    n++;
  }
  const need = 512 - text.length;
  if (need > 0) text = "#" + "x".repeat(need - 2) + "\n" + text;
  if (text.length !== 512) throw new Error("exact512 " + text.length);
  cases.pax10_exact512 = [...pre(), ...pax10("package/m.bin", 300000, map, { mapText: text }), ...post(), ...end()];
}
cases.pax10_two = [...pre(), ...pax10("package/a.bin", 100000, [[0, 512], [99488, 512]]), ...pax10("package/b.bin", 200000, [[1024, 100], [4096, 1]]), ...post(), ...end()];
cases.pax10_longname = [
  ...pre(),
  ...pax([record("GNU.sparse.major", 1), record("GNU.sparse.minor", 0), record("GNU.sparse.name", longdir("s", 70) + "sp.bin"), record("GNU.sparse.realsize", 5000), record("mtime", "1700000002")]),
  ...file("package/GNUSparseFile.0/sp.bin", Buffer.concat([Buffer.from("1\n4096\n904\n"), pad(11), rnd(904, "ln")])),
  ...post(),
  ...end(),
];
cases.pax10_gnuhdr = [
  ...pre(),
  ...pax([record("GNU.sparse.major", 1), record("GNU.sparse.minor", 0), record("GNU.sparse.name", "package/gh.bin"), record("GNU.sparse.realsize", 9000)]),
  ...file("package/GNUSparseFile.0/gh.bin", Buffer.concat([Buffer.from("1\n8000\n1000\n"), pad(12), rnd(1000, "gh")]), { gnu: true }),
  ...post(),
  ...end(),
];

cases.gnu0 = [...pre(), ...gnuSparse("package/m.bin", 300000, [[0, 512], [8192, 512], [299488, 512]]), ...post(), ...end()];
cases.gnu1 = [...pre(), ...gnuSparse("package/m.bin", 300000, G1()), ...post(), ...end()];
cases.gnu2 = [...pre(), ...gnuSparse("package/m.bin", 300000, G2()), ...post(), ...end()];
cases.gnu3 = [...pre(), ...gnuSparse("package/m.bin", 400000, [...mapOf(50, 4096, 64), [399488, 512]]), ...post(), ...end()];
cases.gnu40 = [...pre(), ...gnuSparse("package/m.bin", 4000000, [...mapOf(840, 4096, 8), [3999488, 512]]), ...post(), ...end()];
cases.gnu1_first = [...gnuSparse("package/m.bin", 300000, G1()), ...post(), ...end()];
cases.gnu1_last = [...pre(), ...gnuSparse("package/m.bin", 300000, G1()), ...end()];
cases.gnu1_trailhole = [...pre(), ...gnuSparse("package/m.bin", 300000, [...mapOf(5, 8192, 512), [300000, 0]]), ...post(), ...end()];
cases.gnu_emptyext = [...pre(), ...gnuSparse("package/m.bin", 300000, [[0, 512], [8192, 512], [16384, 512], [299488, 512]], 1), ...post(), ...end()];
cases.gnu1_longname = [...pre(), ...ext("L", Buffer.from(longdir("g", 90) + "sparse.bin\0"), "././@LongLink", { gnu: true }), ...gnuSparse("package/short.bin", 300000, G1()), ...post(), ...end()];
cases.gnu_two = [...pre(), ...gnuSparse("package/a.bin", 300000, mapOf(6, 8192, 512)), ...gnuSparse("package/b.bin", 300000, mapOf(30, 4096, 100)), ...post(), ...end()];
cases.gnu1_pax = [...pre(), ...pax([record("mtime", "1700000005.125"), record("path", longdir("q", 60) + "gp.bin")]), ...gnuSparse("package/short.bin", 300000, G1()), ...post(), ...end()];
{
  const name = "package/m.bin";
  const blocks = [[0, 8], [299992, 8]];
  const data = rnd(16, "pax0x");
  const map01 = [record("GNU.sparse.size", 300000), record("GNU.sparse.numblocks", 2), record("GNU.sparse.name", name), record("GNU.sparse.map", blocks.map(b => b.join(",")).join(","))];
  cases.pax01 = [...pre(), ...pax(map01), ...file("package/GNUSparseFile.0/m.bin", data), ...post(), ...end()];
  cases.pax00 = [...pre(), ...pax([record("GNU.sparse.size", 300000), record("GNU.sparse.numblocks", 2), ...blocks.flatMap(([o, l]) => [record("GNU.sparse.offset", o), record("GNU.sparse.numbytes", l)])]), ...file(name, data), ...post(), ...end()];
  cases.pax01_gnu = [...pre(), ...pax(map01), ...gnuSparse("package/short.bin", 300000, G1()), ...post(), ...end()];
}
cases.sunholes = [...pre(), ...pax([record("SUN.holesdata", " 0 512 1024 1536")], "X"), ...file("package/sun.bin", rnd(1536, "sun")), ...post(), ...end()];

// ---- AppleDouble (run with LA_OPTS=mac-ext) ----
for (const n of [0, 1, 163, 511, 512, 513, 5000, 70000]) {
  cases[`mac_${n}`] = [...pre(), ...file("package/._m.bin", rnd(n, "mac" + n)), ...file("package/m.bin", rnd(700, "macdata")), ...post(), ...end()];
}
cases.mac_pax = [...pre(), ...pax([record("path", longdir("m", 70) + "._res.bin")]), ...file("package/x", rnd(300, "macblob")), ...pax([record("path", longdir("m", 70) + "res.bin")]), ...file("package/y", rnd(900, "macfile")), ...post(), ...end()];
cases.mac_gnulong = [
  ...pre(),
  ...ext("L", Buffer.from(longdir("h", 90) + "._r.bin\0"), "././@LongLink", { gnu: true }),
  ...file("package/x", rnd(300, "mgl"), { gnu: true }),
  ...ext("L", Buffer.from(longdir("h", 90) + "r.bin\0"), "././@LongLink", { gnu: true }),
  ...file("package/y", rnd(900, "mgl2"), { gnu: true }),
  ...post(),
  ...end(),
];
cases.mac_last = [...pre(), ...file("package/._m.bin", rnd(300, "maclast")), ...end()];
cases.mac_two = [...pre(), ...file("package/._a", rnd(300, "a")), ...file("package/a", rnd(10, "a2")), ...file("package/._b", rnd(600, "b")), ...file("package/b", rnd(10, "b2")), ...end()];
cases.mac_mac = [...pre(), ...file("package/._a", rnd(300, "mm1")), ...file("package/._b", rnd(400, "mm2")), ...file("package/b", rnd(10, "mm3")), ...post(), ...end()];
cases.mac_sparse = [...pre(), ...file("package/._m.bin", rnd(300, "ms")), ...pax10("package/m.bin", 300000, P10), ...post(), ...end()];
cases.mac_gnusparse = [...pre(), ...file("package/._m.bin", rnd(300, "mgs")), ...gnuSparse("package/m.bin", 300000, G2()), ...post(), ...end()];
cases.mac_dir = [...pre(), header("package/._d/", 0, "5", { mode: 0o755 }), ...file("package/._d/f", rnd(10, "md")), ...post(), ...end()];

// ---- payloads over 1 MiB ----
const BIG = 1_200_000;
cases.big_comment = [...pre(), ...pax([record("comment", Buffer.alloc(BIG, "c"))]), ...file("package/m.bin", rnd(1000, "bc")), ...post(), ...end()];
cases.big_xattr = [...pre(), ...pax([record("SCHILY.xattr.user.big", rnd(BIG, "xa")), record("path", "package/renamed.bin")]), ...file("package/m.bin", rnd(1000, "bx")), ...post(), ...end()];
{
  const n = 150000;
  const blocks = [];
  for (let i = 0; i < n; i++) blocks.push([i * 2, 1]);
  cases.big_map01 = [...pre(), ...pax([record("GNU.sparse.size", 300000), record("GNU.sparse.numblocks", n), record("GNU.sparse.name", "package/m.bin"), record("GNU.sparse.map", blocks.map(b => b.join(",")).join(","))]), ...file("package/GNUSparseFile.0/m.bin", rnd(n, "bm")), ...post(), ...end()];
}
cases.big_g = [...pax([record("comment", Buffer.alloc(BIG, "g"))], "g"), ...pre(), ...post(), ...end()];
cases.big_L = [...pre(), ...ext("L", Buffer.alloc(BIG, "n"), "././@LongLink", { gnu: true }), ...file("package/short", Buffer.from("x\n"), { gnu: true }), ...post(), ...end()];
cases.big_pax_many = [...pre(), ...pax(Array.from({ length: 30000 }, (_, i) => record(`VENDOR.k${i}`, "v".repeat(30)))), ...file("package/m.bin", rnd(1000, "bpm")), ...post(), ...end()];
cases.big_path = [...pre(), ...pax([record("path", Buffer.alloc(BIG, "p"))]), ...file("package/m.bin", rnd(1000, "bp")), ...post(), ...end()];
// two extension payloads of 900 KB each in one header sequence
cases.big_two_ext = [...pre(), ...pax([record("comment", Buffer.alloc(900_000, "a"))]), ...ext("L", Buffer.concat([Buffer.alloc(900_000, "l"), Buffer.from("\0")]), "././@LongLink", { gnu: true }), ...file("package/short", Buffer.from("y\n"), { gnu: true }), ...post(), ...end()];

// ---- damaged / truncated / concatenated ----
{
  const damaged = Buffer.alloc(512, 0);
  damaged.write("junk");
  damaged.fill(" ", 148, 156);
  cases.damaged = [...pre(), damaged, ...pax10("package/m.bin", 300000, P10), damaged, ...gnuSparse("package/g.bin", 300000, mapOf(6, 8192, 512)), ...post(), ...end()];
  cases.damaged_plain = [...pre(), damaged, ...post(), damaged, damaged, ...file("package/z", rnd(50, "z")), ...end()];
  cases.damaged_after_pax = [...pre(), ...pax([record("path", "package/zz")]), damaged, ...post(), ...end()];
  cases.damaged_after_g = [...pre(), ...pax([record("comment", "gg")], "g"), damaged, ...pax([record("comment", "g2")], "g"), ...post(), ...end()];
}
cases.concat = [...pre(), ...end(), ...pax10("package/m.bin", 300000, P10), ...end(), ...gnuSparse("package/g.bin", 300000, mapOf(6, 8192, 512)), ...post(), ...end()];
const trunc = (parts, cut) => [Buffer.concat(parts).subarray(0, cut)];
cases.trunc_pax10_map = trunc([...pre(), ...pax10("package/m.bin", 300000, P10)], 2560 + 10);
cases.trunc_pax10_pad = trunc([...pre(), ...pax10("package/m.bin", 300000, P10)], 2560 + 100);
cases.trunc_pax10_hdr = trunc([...pre(), ...pax10("package/m.bin", 300000, P10)], 2560);
cases.trunc_gnu_ext = trunc([...pre(), ...gnuSparse("package/m.bin", 300000, G1())], 1536 + 100);
cases.trunc_gnu_noext = trunc([...pre(), ...gnuSparse("package/m.bin", 300000, G1())], 1536);
cases.trunc_gnu_ext2 = trunc([...pre(), ...gnuSparse("package/m.bin", 300000, G2())], 2048 + 7);
cases.trunc_mac = trunc([...pre(), ...file("package/._m.bin", rnd(700, "tm"))], 1536 + 100);
cases.trunc_mac_hdr = trunc([...pre(), ...file("package/._m.bin", rnd(700, "tm"))], 1536);
cases.trunc_pax = trunc([...pre(), ...pax([record("path", longdir("d", 80) + "long.txt")])], 1536 + 60);
cases.trunc_g = trunc([...pre(), ...pax([record("comment", Buffer.alloc(3000, "t"))], "g")], 1536 + 700);
cases.trunc_data = trunc([...pre(), ...file("package/big", rnd(5000, "td"))], 1536 + 2000);
cases.trunc_hdr = trunc([...pre(), ...file("package/big", rnd(5000, "td"))], 1024 + 300);
cases.bad_pax10_alpha = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "1\nabc\n512\n" }), ...post(), ...end()];
cases.bad_pax10_count = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "3\n0\n512\n" }), ...post(), ...end()];
cases.bad_pax10_noeol = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "1\n0\n512" }), ...post(), ...end()];
cases.bad_pax10_longline = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "1\n" + "0".repeat(200) + "\n512\n" }), ...post(), ...end()];
cases.bad_pax10_hugecount = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "99999999999\n0\n512\n" }), ...post(), ...end()];
cases.bad_pax10_neg = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "1\n-5\n512\n" }), ...post(), ...end()];
cases.bad_pax10_overflow = [...pre(), ...pax10("package/m.bin", 300000, [[0, 512]], { mapText: "1\n9223372036854775807\n512\n" }), ...post(), ...end()];
cases.bad_redundant_x = [...pre(), ...pax([record("path", "package/a1")]), ...pax([record("path", "package/a2")]), ...file("package/x", rnd(5, "rx")), ...post(), ...end()];
cases.bad_pax_malformed = [...pre(), ...ext("x", Buffer.from("zz path=package/q\n"), "PaxHeaders.0/x"), ...file("package/x", rnd(5, "pm")), ...post(), ...end()];

const index = {};
for (const [name, parts] of Object.entries(cases)) {
  const tar = Buffer.concat(parts);
  for (const level of [0, 6]) {
    const tgz = gzipSync(tar, { level });
    fs.writeFileSync(`${out}/${name}.l${level}.tgz`, tgz);
    index[`${name}.l${level}`] = { tar: tar.length, tgz: tgz.length };
  }
}
fs.writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
console.log(Object.keys(cases).length, "cases");
