// xmac — download and extract macOS SDKs from Apple's public software-update
// CDN for cross-compilation, without redistributing Apple's SDK. Like xwin,
// but for macOS. Used by scripts/build/macos-sdk.ts to obtain the macOS SDK
// when cross-compiling darwin targets from a Linux host.
//
// VENDORED, GENERATED FILE — the body below is bundled from upstream.
//   source:     https://github.com/jarred-sumner/xmac
//   commit:     f68d2181f1e0fe52ac4c141efe076e262962e855
//   regenerate: bun build --minify-syntax --target=bun xmac.ts --outfile=<bun>/scripts/build/xmac.mjs
//               (then re-add this header + the node shim)
//
// The tool only talks to swscan.apple.com / swdist.apple.com / swcdn.apple.com
// and requires `xz` on PATH. Run `scripts/build/xmac.mjs --help` for usage.

// ── Node-compat shim ──────────────────────────────────────────────────────
// The vendored body was bundled with --target=bun; this shim provides just
// enough of the Bun global for it to run under Node as well. Keeping the
// body pristine makes re-vendoring a diff-only operation.
if (typeof globalThis.Bun === "undefined") {
  const { spawn } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { accessSync, constants, statSync } = await import("node:fs");
  const { delimiter, join } = await import("node:path");
  const { once } = await import("node:events");
  const { setTimeout } = await import("node:timers/promises");
  const { Readable } = await import("node:stream");

  const CryptoHasher = class {
    #h;
    constructor(algo) { this.#h = createHash(algo); }
    update(d) { this.#h.update(d); return this; }
    digest(enc) { return enc ? this.#h.digest(enc) : new Uint8Array(this.#h.digest()); }
  };

  const which = name => {
    const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
    for (const dir of (process.env.PATH ?? "").split(delimiter)) {
      for (const ext of exts) {
        const p = join(dir, name + ext);
        try {
          if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return p; }
        } catch {}
      }
    }
    return null;
  };

  const wrapSpawn = (cmd, opts = {}) => {
    const map = v => (v === "pipe" || v === "ignore" || v === "inherit" ? v : "pipe");
    const cp = spawn(cmd[0], cmd.slice(1), {
      stdio: [map(opts.stdin), map(opts.stdout), map(opts.stderr)],
    });
    const exited = new Promise(res => cp.once("close", code => res(code ?? -1)));
    const stdin = cp.stdin && {
      write: chunk => new Promise((res, rej) => cp.stdin.write(chunk, e => (e ? rej(e) : res(chunk.length)))),
      flush: async () => { if (cp.stdin.writableNeedDrain) await once(cp.stdin, "drain"); },
      end: () => new Promise(res => cp.stdin.end(res)),
    };
    return {
      stdin,
      stdout: cp.stdout ? Readable.toWeb(cp.stdout) : undefined,
      stderr: cp.stderr ? Readable.toWeb(cp.stderr) : undefined,
      exited,
      kill: sig => cp.kill(sig),
    };
  };

  globalThis.Bun = { CryptoHasher, which, sleep: setTimeout, spawn: wrapSpawn };
}
// ──────────────────────────────────────────────────────────────────────────

// src/main.ts
import * as fs7 from "fs";
import * as path7 from "path";

// src/util.ts
var VERSION = "0.1.0", DEFAULT_SUCATALOG = "https://swscan.apple.com/content/catalogs/others/index-26-15-14-13-12-10.16-10.15-10.14-10.13-10.12-10.11-10.10-10.9-mountainlion-lion-snowleopard-leopard.merged-1.sucatalog.gz", USER_AGENT = "xmac/0.1.0 (Software%20Update; like swupd)";

class XmacError extends Error {
}
function die(msg) {
  console.error(`error: ${msg}`), process.exit(1);
}
var quiet = !1;
function setQuiet(q) {
  quiet = q;
}
function isQuiet() {
  return quiet;
}
function log(msg) {
  if (!quiet)
    console.error(msg);
}
function humanSize(n) {
  if (n < 1024)
    return `${n} B`;
  let units = ["KiB", "MiB", "GiB", "TiB"], v = n, i = -1;
  do
    v /= 1024, i++;
  while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
function thousands(n) {
  return n.toLocaleString("en-US");
}
function asBuffer(u8) {
  return Buffer.isBuffer(u8) ? u8 : Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}
function sha1Hex(buf) {
  let h = new Bun.CryptoHasher("sha1");
  return h.update(buf), h.digest("hex");
}
function compareVersions(a, b) {
  let pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0;i < Math.max(pa.length, pb.length); i++) {
    let d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0)
      return d;
  }
  return 0;
}
async function mapLimit(items, limit, fn) {
  let results = Array.from({ length: items.length }), next = 0, workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!0) {
      let i = next++;
      if (i >= items.length)
        return;
      results[i] = await fn(items[i], i);
    }
  });
  return await Promise.all(workers), results;
}

// src/commands.ts
import * as fs6 from "fs";
import * as path6 from "path";

// src/ui.ts
var interactive = Boolean(process.stderr.isTTY), colorEnabled = process.env.FORCE_COLOR !== void 0 ? process.env.FORCE_COLOR !== "0" : interactive && process.env.NO_COLOR === void 0 && process.env.TERM !== "dumb", wrap = (open, close) => (s) => colorEnabled ? `\x1B[${open}m${s}\x1B[${close}m` : s, c = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  cyan: wrap("36", "39"),
  magenta: wrap("35", "39")
};
function eprintln(line) {
  process.stderr.write(line + `
`);
}
function status(msg) {
  if (isQuiet())
    return;
  eprintln(interactive ? `${c.cyan("\u2192")} ${msg}` : msg);
}
function ok(msg) {
  if (isQuiet())
    return;
  eprintln(interactive ? `${c.green("\u2713")} ${msg}` : msg);
}
function warn(msg) {
  eprintln(interactive ? `${c.yellow("!")} ${msg}` : `warning: ${msg}`);
}
function note(msg) {
  if (isQuiet())
    return;
  eprintln(interactive ? `  ${c.dim(msg)}` : `  ${msg}`);
}
function result(pairs) {
  if (interactive) {
    let w = Math.max(...pairs.map(([k]) => k.length));
    for (let [k, v] of pairs)
      console.log(`  ${c.dim(k.padEnd(w))}  ${v}`);
  } else
    for (let [k, v] of pairs)
      console.log(`${k}: ${v}`);
}
function table(rows) {
  if (rows.length === 0)
    return;
  let widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))), fmt = (row, decorate) => "  " + row.map((cell, i) => decorate(i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  ");
  rows.forEach((row, idx) => {
    if (idx === 0)
      console.log(fmt(row, (s) => c.bold(s)));
    else
      console.log(fmt(row, (s) => s));
  });
}

class Progress {
  label;
  total;
  last = 0;
  constructor(label, total) {
    this.label = label;
    this.total = total;
  }
  update(done) {
    if (isQuiet() || !interactive)
      return;
    let now = Date.now();
    if (now - this.last < 100 && done < this.total)
      return;
    this.last = now;
    let pct = this.total > 0 ? Math.min(100, Math.floor(done / this.total * 100)) : 0, cols = process.stderr.columns || 80, suffix = ` ${String(pct).padStart(3)}% ${humanSize(done)} / ${humanSize(this.total)}`, label = this.label, width = Math.min(28, cols - 1 - 2 - label.length - 1 - suffix.length);
    if (width < 10)
      suffix = ` ${String(pct).padStart(3)}%`, width = Math.min(28, cols - 1 - 2 - label.length - 1 - suffix.length);
    if (width < 10) {
      let room = Math.max(4, cols - 1 - 2 - 1 - suffix.length - 10);
      label = label.length > room ? label.slice(0, room - 1) + "\u2026" : label, width = Math.min(28, cols - 1 - 2 - label.length - 1 - suffix.length);
    }
    if (width < 4) {
      process.stderr.write(`\r  ${String(pct).padStart(3)}%\x1B[K`);
      return;
    }
    let filled = Math.min(width, Math.floor(width * pct / 100)), bar = c.cyan("\u2588".repeat(filled)) + c.dim("\u2591".repeat(width - filled));
    process.stderr.write(`\r  ${label} ${bar}${suffix}\x1B[K`);
  }
  finish() {
    if (isQuiet() || !interactive)
      return;
    process.stderr.write("\r\x1B[K");
  }
}

// src/xml.ts
function decodeEntities(s) {
  if (!s.includes("&"))
    return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      let code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    switch (ent) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return m;
    }
  });
}
function parseXml(input) {
  let i = 0, n = input.length, root = { tag: "#root", attrs: {}, children: [], text: "" }, stack = [root], top = () => stack[stack.length - 1];
  while (i < n) {
    let lt = input.indexOf("<", i);
    if (lt === -1) {
      top().text += decodeEntities(input.slice(i));
      break;
    }
    if (lt > i)
      top().text += decodeEntities(input.slice(i, lt));
    if (i = lt, input.startsWith("<!--", i)) {
      let end2 = input.indexOf("-->", i + 4);
      if (end2 === -1)
        throw new XmacError("xml: unterminated comment");
      i = end2 + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      let end2 = input.indexOf("]]>", i + 9);
      if (end2 === -1)
        throw new XmacError("xml: unterminated CDATA");
      top().text += input.slice(i + 9, end2), i = end2 + 3;
      continue;
    }
    if (input.startsWith("<!", i) || input.startsWith("<?", i)) {
      let end2 = input.indexOf(">", i);
      if (end2 === -1)
        throw new XmacError("xml: unterminated declaration");
      i = end2 + 1;
      continue;
    }
    if (input.startsWith("</", i)) {
      let end2 = input.indexOf(">", i);
      if (end2 === -1)
        throw new XmacError("xml: unterminated close tag");
      let name = input.slice(i + 2, end2).trim();
      if (stack.length < 2 || top().tag !== name)
        throw new XmacError(`xml: mismatched close tag </${name}> (open: <${top().tag}>)`);
      stack.pop(), i = end2 + 1;
      continue;
    }
    let end = input.indexOf(">", i);
    if (end === -1)
      throw new XmacError("xml: unterminated open tag");
    let tagBody = input.slice(i + 1, end);
    i = end + 1;
    let selfClose = !1;
    if (tagBody.endsWith("/"))
      selfClose = !0, tagBody = tagBody.slice(0, -1);
    let m = /^([^\s]+)\s*/.exec(tagBody);
    if (!m)
      throw new XmacError("xml: empty tag");
    let node = { tag: m[1], attrs: {}, children: [], text: "" }, rest = tagBody.slice(m[0].length), attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')\s*/g, am;
    while ((am = attrRe.exec(rest)) !== null)
      node.attrs[am[1]] = decodeEntities(am[3] ?? am[4] ?? "");
    if (top().children.push(node), !selfClose)
      stack.push(node);
  }
  if (stack.length !== 1)
    throw new XmacError(`xml: unclosed element <${top().tag}>`);
  return root;
}
function firstChild(node, tag) {
  return node.children.find((co) => co.tag === tag);
}
function childText(node, tag) {
  let co = firstChild(node, tag);
  return co ? co.text.trim() : void 0;
}
function plistToJs(node) {
  switch (node.tag) {
    case "dict": {
      let out = {}, kids = node.children;
      for (let i = 0;i < kids.length; i++) {
        if (kids[i].tag !== "key")
          continue;
        let key = kids[i].text, val = kids[i + 1];
        if (!val)
          break;
        out[key] = plistToJs(val), i++;
      }
      return out;
    }
    case "array":
      return node.children.map(plistToJs);
    case "string":
      return node.text;
    case "integer":
      return parseInt(node.text.trim(), 10);
    case "real":
      return parseFloat(node.text.trim());
    case "date":
      return new Date(node.text.trim());
    case "true":
      return !0;
    case "false":
      return !1;
    case "data":
      return Uint8Array.from(atob(node.text.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
    default:
      throw new XmacError(`plist: unexpected element <${node.tag}>`);
  }
}
function parsePlist(xml) {
  let root = parseXml(xml), plist = firstChild(root, "plist");
  if (!plist || plist.children.length === 0)
    throw new XmacError("plist: missing <plist> root");
  return plistToJs(plist.children[0]);
}

// src/net.ts
import * as fs from "fs";
import * as path from "path";
async function httpGet(url, opts = {}) {
  let retries = opts.retries ?? 3, lastErr;
  for (let attempt = 0;attempt <= retries; attempt++) {
    if (attempt > 0) {
      let delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await Bun.sleep(delay), log(`  retrying (${attempt}/${retries}) ${url}`);
    }
    try {
      let headers = { "User-Agent": USER_AGENT };
      if (opts.range)
        headers.Range = `bytes=${opts.range[0]}-${opts.range[1]}`;
      let res = await fetch(url, { headers, redirect: "follow" });
      if (res.status === 200 || res.status === 206)
        return res;
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw new XmacError(`GET ${url}: HTTP ${res.status}`);
      lastErr = new XmacError(`GET ${url}: HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof XmacError)
        throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new XmacError(`GET ${url}: ${lastErr}`);
}
async function httpGetBytes(url, range) {
  let res = await httpGet(url, { range });
  return new Uint8Array(await res.arrayBuffer());
}
async function downloadTo(url, dest, expectedSize, expectedSha1, label) {
  let name = label ?? path.basename(dest);
  if (fs.existsSync(dest)) {
    if (fs.statSync(dest).size === expectedSize) {
      if (!expectedSha1) {
        note(`${name}: cached`);
        return;
      }
      let h = new Bun.CryptoHasher("sha1"), fd = fs.openSync(dest, "r");
      try {
        let buf = Buffer.alloc(4194304), r;
        while ((r = fs.readSync(fd, buf, 0, buf.length, -1)) > 0)
          h.update(buf.subarray(0, r));
      } finally {
        fs.closeSync(fd);
      }
      if (h.digest("hex") === expectedSha1.toLowerCase()) {
        note(`${name}: cached (checksum ok)`);
        return;
      }
      note(`${name}: cached file failed checksum, re-downloading`);
    }
    fs.rmSync(dest, { force: !0 });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: !0 });
  let tmp = `${dest}.part`, res = await httpGet(url), total = Number(res.headers.get("content-length") ?? expectedSize) || expectedSize, prog = new Progress(name, total), hasher = new Bun.CryptoHasher("sha1"), sink = fs.createWriteStream(tmp), done = 0;
  try {
    if (!res.body)
      throw new XmacError(`GET ${url}: empty body`);
    for await (let chunk of res.body) {
      let u8 = chunk;
      if (hasher.update(u8), done += u8.byteLength, prog.update(done), !sink.write(u8))
        await new Promise((r) => sink.once("drain", () => r()));
    }
    if (await new Promise((resolve, reject) => sink.end((err) => err ? reject(err) : resolve())), expectedSize && done !== expectedSize)
      throw new XmacError(`${url}: size mismatch (got ${done}, expected ${expectedSize})`);
    let got = hasher.digest("hex");
    if (expectedSha1 && got !== expectedSha1.toLowerCase())
      throw new XmacError(`${url}: SHA-1 mismatch (got ${got}, expected ${expectedSha1})`);
  } catch (e) {
    throw sink.destroy(), fs.rmSync(tmp, { force: !0 }), e;
  }
  fs.renameSync(tmp, dest), prog.finish(), ok(`downloaded ${name} (${humanSize(done)})`);
}

// src/catalog.ts
import * as fs3 from "fs";
import * as path3 from "path";
import * as zlib2 from "zlib";

// src/xar.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as zlib from "zlib";

// src/exec.ts
var toolCache = /* @__PURE__ */ new Map;
function requireTool(name) {
  let p = toolCache.get(name);
  if (p)
    return p;
  if (p = Bun.which(name) ?? "", !p)
    throw new XmacError(`required tool '${name}' not found on PATH. Install it (e.g. apt-get install ${name === "xz" ? "xz-utils" : name}) and retry.`);
  return toolCache.set(name, p), p;
}
async function decompressWith(tool, args, input, allowFailure = !1) {
  let proc = Bun.spawn([requireTool(tool), ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: allowFailure ? "ignore" : "pipe"
  }), writer = (async () => {
    try {
      proc.stdin.write(input), await proc.stdin.end();
    } catch {}
  })(), out = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await writer;
  let code = await proc.exited;
  if (code !== 0 && !allowFailure) {
    let err = proc.stderr ? await new Response(proc.stderr).text() : `exit ${code}`;
    throw new XmacError(`${tool} failed: ${err.trim() || `exit ${code}`}`);
  }
  return out;
}

// src/xar.ts
var XAR_MAGIC = 2019652129;
function parseXarHeader(buf) {
  if (buf.length < 28)
    throw new XmacError("xar: file too small");
  let b = asBuffer(buf);
  if (b.readUInt32BE(0) !== XAR_MAGIC)
    throw new XmacError("xar: bad magic \u2014 this does not look like a flat .pkg/.xar file");
  let headerSize = b.readUInt16BE(4), version = b.readUInt16BE(6);
  if (version !== 1)
    throw new XmacError(`xar: unsupported version ${version}`);
  let tocCompressedLength = Number(b.readBigUInt64BE(8)), tocUncompressedLength = Number(b.readBigUInt64BE(16));
  return {
    headerSize,
    tocCompressedLength,
    tocUncompressedLength,
    heapStart: headerSize + tocCompressedLength
  };
}
function parseXarToc(tocXml) {
  let root = parseXml(tocXml), xar = firstChild(root, "xar"), toc = xar && firstChild(xar, "toc");
  if (!toc)
    throw new XmacError("xar: missing <toc>");
  let entries = [], walk = (node, prefix) => {
    for (let f of node.children) {
      if (f.tag !== "file")
        continue;
      let name = childText(f, "name") ?? "", full = prefix ? `${prefix}/${name}` : name, type = childText(f, "type") ?? "file", data = firstChild(f, "data"), offset = 0, size = 0, length = 0, encoding = "application/octet-stream", archivedChecksum;
      if (data) {
        offset = parseInt(childText(data, "offset") ?? "0", 10), size = parseInt(childText(data, "size") ?? "0", 10), length = parseInt(childText(data, "length") ?? "0", 10);
        let enc = firstChild(data, "encoding");
        if (enc?.attrs.style)
          encoding = enc.attrs.style;
        let ac = firstChild(data, "archived-checksum");
        if (ac)
          archivedChecksum = {
            style: ac.attrs.style ?? "",
            value: ac.text.trim()
          };
      }
      entries.push({
        name: full,
        type,
        offset,
        size,
        length,
        encoding,
        archivedChecksum
      }), walk(f, full);
    }
  };
  return walk(toc, ""), entries;
}
async function xarDecode(data, encoding) {
  switch (encoding) {
    case "application/octet-stream":
      return data;
    case "application/x-gzip":
    case "application/zlib":
    case "application/x-zlib":
      return zlib.inflateSync(data);
    case "application/x-bzip2":
    case "application/bzip2":
      return decompressWith("bzip2", ["-dc"], data);
    case "application/x-lzma":
    case "application/x-xz":
      return decompressWith("xz", ["-dc", "-T0"], data);
    default:
      throw new XmacError(`xar: unsupported encoding '${encoding}'`);
  }
}

class XarFile {
  fd;
  header;
  entries;
  filePath;
  constructor(fd, header, entries, filePath) {
    this.fd = fd;
    this.header = header;
    this.entries = entries;
    this.filePath = filePath;
  }
  static open(filePath) {
    let fd = fs2.openSync(filePath, "r");
    try {
      let head = Buffer.alloc(28);
      fs2.readSync(fd, head, 0, 28, 0);
      let header = parseXarHeader(head), ctoc = Buffer.alloc(header.tocCompressedLength);
      fs2.readSync(fd, ctoc, 0, ctoc.length, header.headerSize);
      let toc = zlib.inflateSync(ctoc), entries = parseXarToc((/* @__PURE__ */ new TextDecoder()).decode(toc));
      return new XarFile(fd, header, entries, filePath);
    } catch (e) {
      throw fs2.closeSync(fd), e;
    }
  }
  close() {
    fs2.closeSync(this.fd);
  }
  find(name) {
    return this.entries.find((e) => e.name === name);
  }
  async readEntry(entry) {
    let raw = Buffer.alloc(entry.size);
    if (fs2.readSync(this.fd, raw, 0, entry.size, this.header.heapStart + entry.offset), entry.archivedChecksum?.style === "sha1") {
      if (sha1Hex(raw) !== entry.archivedChecksum.value.toLowerCase())
        throw new XmacError(`xar: checksum mismatch for '${entry.name}' in ${path2.basename(this.filePath)}`);
    }
    return xarDecode(raw, entry.encoding);
  }
  async* streamRaw(entry, sliceSize = 4194304) {
    if (entry.encoding !== "application/octet-stream")
      throw new XmacError(`xar: cannot stream '${entry.name}' with encoding ${entry.encoding}`);
    let algo = entry.archivedChecksum?.style, hasher = algo === "sha1" || algo === "sha256" || algo === "sha512" || algo === "md5" ? new Bun.CryptoHasher(algo) : void 0, pos = 0;
    while (pos < entry.size) {
      let n = Math.min(sliceSize, entry.size - pos), buf = Buffer.alloc(n);
      if (fs2.readSync(this.fd, buf, 0, n, this.header.heapStart + entry.offset + pos) !== n)
        throw new XmacError(`xar: short read in '${entry.name}'`);
      pos += n, hasher?.update(buf), yield buf;
    }
    if (hasher) {
      if (hasher.digest("hex") !== entry.archivedChecksum.value.toLowerCase())
        throw new XmacError(`xar: ${algo} checksum mismatch for '${entry.name}' in ${path2.basename(this.filePath)} \u2014 the download is corrupt; delete it from the cache and retry`);
    }
  }
}

// src/catalog.ts
function displayName(r) {
  return r.title.endsWith(r.version) ? r.title : `${r.title} ${r.version}`;
}
function isSdkPackage(url) {
  let f = url.split("/").pop() ?? "";
  return /^CLTools_.*SDK.*\.pkg$/i.test(f) && !/DevSDK_Remove/i.test(f);
}
async function fetchCatalog(catalogUrl) {
  let data = await httpGetBytes(catalogUrl);
  if (data[0] === 31 && data[1] === 139)
    data = zlib2.gunzipSync(data);
  return parsePlist((/* @__PURE__ */ new TextDecoder()).decode(data));
}
function extractCltProducts(catalog) {
  let products = catalog.Products;
  if (!products)
    throw new XmacError("catalog: missing Products dict");
  let out = [];
  for (let [productId, p] of Object.entries(products)) {
    let prod = p, packages = (prod.Packages ?? []).map((x) => {
      let d = x;
      return {
        url: String(d.URL ?? ""),
        size: Number(d.Size ?? 0),
        digest: d.Digest ? String(d.Digest) : void 0,
        metadataUrl: d.MetadataURL ? String(d.MetadataURL) : void 0
      };
    });
    if (!packages.some((x) => /\/CLTools_/.test(x.url)))
      continue;
    if (!packages.some((x) => isSdkPackage(x.url)))
      continue;
    let dists = prod.Distributions, distributionUrl = dists ? String(dists.English ?? dists.en ?? Object.values(dists)[0] ?? "") : void 0, postDate = prod.PostDate;
    out.push({
      productId,
      postDate: postDate instanceof Date ? postDate.toISOString().slice(0, 10) : String(postDate ?? ""),
      distributionUrl: distributionUrl || void 0,
      packages
    });
  }
  return out;
}
async function fetchDistInfo(url) {
  let text = (/* @__PURE__ */ new TextDecoder()).decode(await httpGetBytes(url)), grab = (key) => {
    let m = new RegExp(`"${key}"\\s*=\\s*"([^"]*)"`).exec(text);
    return m ? m[1] : void 0;
  }, title = grab("SU_TITLE"), version = grab("SU_VERS");
  if (!title) {
    let m = /<title>([^<]*)<\/title>/.exec(text);
    if (m && m[1] !== "SU_TITLE")
      title = m[1];
  }
  if (!version) {
    let m = /<pkg-ref[^>]*\bversion="(\d+\.\d+)/.exec(text);
    if (m)
      version = m[1];
  }
  return { title: title ?? "Command Line Tools", version: version ?? "?" };
}
async function fetchDistribution(release) {
  if (!release.distributionUrl)
    throw new XmacError("no distribution document is available for this release");
  return (/* @__PURE__ */ new TextDecoder()).decode(await httpGetBytes(release.distributionUrl));
}
async function peekSdkName(pkg) {
  try {
    let head = await httpGetBytes(pkg.url, [0, 65535]), hdr = parseXarHeader(head);
    if (head.length < hdr.headerSize + hdr.tocCompressedLength)
      head = await httpGetBytes(pkg.url, [0, hdr.headerSize + hdr.tocCompressedLength - 1]);
    let toc = zlib2.inflateSync(head.subarray(hdr.headerSize, hdr.headerSize + hdr.tocCompressedLength)), payload = parseXarToc((/* @__PURE__ */ new TextDecoder()).decode(toc)).find((e) => e.name === "Payload");
    if (!payload)
      return;
    let start = hdr.heapStart + payload.offset, want = Math.min(payload.size, 98304), data = await httpGetBytes(pkg.url, [start, start + want - 1]), cpio;
    if ((/* @__PURE__ */ new TextDecoder()).decode(data.subarray(0, 4)) === "pbzx") {
      let b = asBuffer(data), uncompressedSize = Number(b.readBigUInt64BE(12)), compressedSize = Number(b.readBigUInt64BE(20)), chunk = data.subarray(28, Math.min(28 + compressedSize, data.length));
      cpio = compressedSize === uncompressedSize ? chunk : await decompressWith("xz", ["-dcq"], chunk, !0);
    } else if (data[0] === 31 && data[1] === 139)
      cpio = await decompressWith("gzip", ["-dcq"], data, !0);
    else
      return;
    let text = asBuffer(cpio.subarray(0, 65536)).toString("latin1"), m = /SDKs\/([A-Za-z0-9_.]+\.sdk)/.exec(text);
    return m ? m[1] : void 0;
  } catch {
    return;
  }
}
async function getManifest(opts, forceRefresh = !1) {
  let cachePath = path3.join(opts.cacheDir, "manifest.json");
  if (!forceRefresh && fs3.existsSync(cachePath))
    try {
      let m = JSON.parse(fs3.readFileSync(cachePath, "utf8"));
      if (m.catalogUrl === opts.catalog && Array.isArray(m.releases)) {
        let age = Date.now() - new Date(m.fetchedAt).getTime();
        if (opts.offline || age < 86400000)
          return m;
      }
    } catch {}
  if (opts.offline)
    throw new XmacError(`--offline was passed but no cached manifest exists at ${cachePath}. Run \`xmac list\` online once first.`);
  log("Fetching Apple software update catalog\u2026");
  let catalog = await fetchCatalog(opts.catalog), products = extractCltProducts(catalog);
  log(`Resolving ${products.length} Command Line Tools releases\u2026`);
  let filtered = (await mapLimit(products, 8, async (p) => {
    let sdkPkgs = p.packages.filter((x) => isSdkPackage(x.url)).map((x) => ({
      fileName: x.url.split("/").pop() ?? "pkg",
      url: x.url,
      size: x.size,
      digest: x.digest
    })).filter((x) => x.size > 1048576), info = p.distributionUrl ? await fetchDistInfo(p.distributionUrl).catch(() => ({
      title: "Command Line Tools",
      version: "?"
    })) : { title: "Command Line Tools", version: "?" };
    return await Promise.all(sdkPkgs.map(async (s) => {
      if (s.sdkName = await peekSdkName(s), s.sdkName) {
        let m = /^MacOSX(\d+(?:\.\d+)*)\.sdk$/i.exec(s.sdkName);
        if (m)
          s.sdkVersion = m[1];
      }
    })), {
      productId: p.productId,
      postDate: p.postDate,
      version: info.version,
      title: info.title,
      distributionUrl: p.distributionUrl,
      sdkPackages: sdkPkgs
    };
  })).filter((r) => r.sdkPackages.length > 0);
  filtered.sort((a, b) => {
    let d = a.postDate.localeCompare(b.postDate);
    return d !== 0 ? d : compareVersions(a.version, b.version);
  }), filtered.reverse();
  let manifest = {
    catalogUrl: opts.catalog,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    releases: filtered
  };
  return fs3.mkdirSync(opts.cacheDir, { recursive: !0 }), fs3.writeFileSync(cachePath, JSON.stringify(manifest, null, 2)), manifest;
}
function selectSdks(manifest, sdkSpec, releaseSpec) {
  let releases = manifest.releases;
  if (releases.length === 0)
    throw new XmacError("no Command Line Tools releases found in the catalog");
  if (releaseSpec) {
    if (releases = releases.filter((r) => r.productId === releaseSpec || r.version === releaseSpec), releases.length === 0)
      throw new XmacError(`no Command Line Tools release matches '${releaseSpec}'. Run \`xmac list\` to see what is available.`);
  }
  let spec = sdkSpec.trim();
  if (spec.toLowerCase() === "all") {
    let release = releases[0];
    return { release, packages: release.sdkPackages };
  }
  let candidates = [];
  for (let r of releases)
    for (let p of r.sdkPackages)
      candidates.push({ release: r, pkg: p });
  if (spec.toLowerCase() === "latest") {
    let best;
    for (let cand of candidates) {
      if (!best) {
        best = cand;
        continue;
      }
      let a = cand.pkg.sdkVersion ?? "0", b = best.pkg.sdkVersion ?? "0";
      if (compareVersions(a, b) > 0)
        best = cand;
    }
    if (!best)
      throw new XmacError("no SDK packages found");
    return { release: best.release, packages: [best.pkg] };
  }
  let vm = /^(?:macosx)?(\d+(?:\.\d+)*)(?:\.sdk)?$/i.exec(spec);
  if (!vm)
    throw new XmacError(`invalid --sdk '${spec}'. Use 'latest', 'all', a version like '14.5', or a name like 'MacOSX14.5.sdk'.`);
  let wanted = vm[1], exact = candidates.filter((cand) => cand.pkg.sdkVersion === wanted), prefix = candidates.filter((cand) => cand.pkg.sdkVersion && (cand.pkg.sdkVersion === wanted || cand.pkg.sdkVersion.startsWith(wanted + "."))), pool = exact.length > 0 ? exact : prefix;
  if (pool.length === 0) {
    let known = [
      ...new Set(candidates.map((cand) => cand.pkg.sdkVersion).filter(Boolean))
    ].sort(compareVersions);
    throw new XmacError(`no macOS ${wanted} SDK found in the catalog.
Available SDK versions: ${known.join(", ")}`);
  }
  return pool = [...pool].sort((a, b) => {
    let d = compareVersions(b.pkg.sdkVersion ?? "0", a.pkg.sdkVersion ?? "0");
    return d !== 0 ? d : b.release.postDate.localeCompare(a.release.postDate);
  }), { release: pool[0].release, packages: [pool[0].pkg] };
}

// src/extract.ts
import * as fs4 from "fs";
import * as path4 from "path";

// src/bytes.ts
class ByteReader {
  src;
  buf = new Uint8Array(0);
  pos = 0;
  done = !1;
  constructor(src) {
    this.src = src;
  }
  get buffered() {
    return this.buf.length - this.pos;
  }
  async fill() {
    if (this.done)
      return !1;
    let { value, done } = await this.src.next();
    if (done || !value)
      return this.done = !0, !1;
    if (value.byteLength === 0)
      return this.fill();
    if (this.pos >= this.buf.length)
      this.buf = value;
    else
      this.buf = Buffer.concat([this.buf.subarray(this.pos), value]);
    return this.pos = 0, !0;
  }
  async readExact(n) {
    while (this.buffered < n)
      if (!await this.fill()) {
        if (this.buffered === 0)
          return null;
        throw new XmacError(`unexpected end of stream (wanted ${n} bytes, had ${this.buffered})`);
      }
    let out = this.buf.subarray(this.pos, this.pos + n);
    return this.pos += n, out;
  }
  async* readStream(n) {
    let remaining = n;
    while (remaining > 0) {
      if (this.buffered === 0 && !await this.fill())
        throw new XmacError(`unexpected end of stream (wanted ${remaining} more bytes)`);
      let take = Math.min(this.buffered, remaining), out = this.buf.subarray(this.pos, this.pos + take);
      this.pos += take, remaining -= take, yield out;
    }
  }
  async skip(n) {
    for await (let _ of this.readStream(n))
      ;
  }
  async atEof() {
    if (this.buffered > 0)
      return !1;
    return !await this.fill();
  }
}

// src/pbzx.ts
var XZ_MAGIC = Buffer.from([253, 55, 122, 88, 90, 0]);
async function* pbzxDecompress(source, onProgress) {
  let reader = new ByteReader(source[Symbol.asyncIterator]()), magic = await reader.readExact(4);
  if (!magic || (/* @__PURE__ */ new TextDecoder()).decode(magic) !== "pbzx")
    throw new XmacError("payload: missing pbzx magic");
  await reader.skip(8);
  let consumed = 12, nextChunk = async () => {
    let hdr = await reader.readExact(16);
    if (hdr === null)
      return null;
    let b = asBuffer(hdr), uncompressedSize = Number(b.readBigUInt64BE(0)), compressedSize = Number(b.readBigUInt64BE(8));
    if (compressedSize <= 0 || uncompressedSize < 0)
      throw new XmacError("payload: corrupt pbzx chunk header");
    return consumed += 16, {
      uncompressedSize,
      compressedSize,
      raw: compressedSize === uncompressedSize
    };
  }, pending = await nextChunk();
  while (pending !== null) {
    if (pending.raw) {
      for await (let piece of reader.readStream(pending.compressedSize))
        consumed += piece.byteLength, onProgress?.(consumed), yield piece;
      pending = await nextChunk();
      continue;
    }
    let proc = Bun.spawn([requireTool("xz"), "-dc", "-T0"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe"
    }), writerError = null, writer = (async () => {
      try {
        while (pending !== null && !pending.raw) {
          let first = !0;
          for await (let piece of reader.readStream(pending.compressedSize)) {
            if (first) {
              if (first = !1, piece.byteLength >= 6 && Buffer.compare(piece.subarray(0, 6), XZ_MAGIC) !== 0)
                throw new XmacError("payload: pbzx chunk is neither raw nor XZ \u2014 unsupported variant");
            }
            consumed += piece.byteLength, onProgress?.(consumed);
            let r = proc.stdin.write(piece);
            if (r && typeof r.then === "function")
              await r;
            await proc.stdin.flush();
          }
          pending = await nextChunk();
        }
      } catch (e) {
        writerError = e;
        try {
          proc.kill();
        } catch {}
      } finally {
        try {
          await proc.stdin.end();
        } catch {}
      }
    })();
    for await (let out of proc.stdout)
      yield out;
    await writer;
    let code = await proc.exited;
    if (writerError)
      throw writerError;
    if (code !== 0) {
      let err = await new Response(proc.stderr).text();
      throw new XmacError(`xz failed while decompressing payload: ${err.trim() || `exit ${code}`}`);
    }
  }
}
async function* pipeThrough(cmd, source, onProgress) {
  let proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" }), writerError = null, writer = (async () => {
    try {
      let n = 0;
      for await (let piece of source) {
        n += piece.byteLength, onProgress?.(n);
        let r = proc.stdin.write(piece);
        if (r && typeof r.then === "function")
          await r;
        await proc.stdin.flush();
      }
    } catch (e) {
      writerError = e;
      try {
        proc.kill();
      } catch {}
    } finally {
      try {
        await proc.stdin.end();
      } catch {}
    }
  })();
  for await (let out of proc.stdout)
    yield out;
  await writer;
  let code = await proc.exited;
  if (writerError)
    throw writerError;
  if (code !== 0) {
    let err = await new Response(proc.stderr).text();
    throw new XmacError(`${cmd[0]} failed while decompressing payload: ${err.trim() || `exit ${code}`}`);
  }
}
async function* decompressPayload(source, onProgress) {
  let it = source[Symbol.asyncIterator](), first = await it.next();
  if (first.done || !first.value)
    throw new XmacError("payload: empty");
  let head = first.value, rest = {
    async* [Symbol.asyncIterator]() {
      yield head;
      while (!0) {
        let n = await it.next();
        if (n.done)
          return;
        yield n.value;
      }
    }
  };
  if (head.byteLength >= 4 && (/* @__PURE__ */ new TextDecoder()).decode(head.subarray(0, 4)) === "pbzx") {
    yield* pbzxDecompress(rest, onProgress);
    return;
  }
  if (head[0] === 31 && head[1] === 139) {
    yield* pipeThrough([requireTool("gzip"), "-dc"], rest, onProgress);
    return;
  }
  if (head.byteLength >= 6 && Buffer.compare(head.subarray(0, 6), XZ_MAGIC) === 0) {
    yield* pipeThrough([requireTool("xz"), "-dc", "-T0"], rest, onProgress);
    return;
  }
  throw new XmacError(`payload: unrecognized format (first bytes: ${Buffer.from(head.subarray(0, 8)).toString("hex")})`);
}

// src/cpio.ts
var S_IFMT = 61440, S_IFDIR = 16384, S_IFREG = 32768, S_IFLNK = 40960;
function parseOctal(buf, off, len) {
  let v = 0;
  for (let i = 0;i < len; i++) {
    let ch = buf[off + i];
    if (ch === 32 || ch === 0)
      continue;
    v = v * 8 + (ch - 48);
  }
  return v;
}
function parseHex(buf, off, len) {
  let v = 0;
  for (let i = 0;i < len; i++) {
    let ch = buf[off + i], d;
    if (ch >= 48 && ch <= 57)
      d = ch - 48;
    else if (ch >= 65 && ch <= 70)
      d = ch - 55;
    else if (ch >= 97 && ch <= 102)
      d = ch - 87;
    else
      continue;
    v = v * 16 + d;
  }
  return v;
}
async function* cpioEntries(source) {
  let reader = new ByteReader(source[Symbol.asyncIterator]()), dec = /* @__PURE__ */ new TextDecoder, offset = 0, readExact = async (n) => {
    let b = await reader.readExact(n);
    if (b !== null)
      offset += n;
    return b;
  }, skipN = async (n) => {
    if (n <= 0)
      return;
    await reader.skip(n), offset += n;
  }, sawTrailer = !1;
  while (!0) {
    if (await reader.atEof())
      return;
    let magicBuf = await readExact(6);
    if (magicBuf === null)
      return;
    let magic = dec.decode(magicBuf), mode, namesize, filesize, align = 1;
    if (magic === "070707") {
      let h = await readExact(70);
      if (h === null)
        throw new XmacError("cpio: truncated odc header");
      mode = parseOctal(h, 12, 6), namesize = parseOctal(h, 53, 6), filesize = parseOctal(h, 59, 11);
    } else if (magic === "070701" || magic === "070702") {
      let h = await readExact(104);
      if (h === null)
        throw new XmacError("cpio: truncated newc header");
      mode = parseHex(h, 8, 8), filesize = parseHex(h, 48, 8), namesize = parseHex(h, 88, 8), align = 4;
    } else if (magicBuf.every((b) => b === 0)) {
      while (!await reader.atEof())
        await reader.skip(reader.buffered || 1);
      return;
    } else if (sawTrailer)
      return;
    else if (magicBuf[0] === 199 && magicBuf[1] === 113)
      throw new XmacError("cpio: binary (bin/crc) cpio archives are not supported");
    else
      throw new XmacError(`cpio: bad magic '${asBuffer(magicBuf).toString("hex")}' at offset ${offset - 6}`);
    let nameBuf = await readExact(namesize);
    if (nameBuf === null)
      throw new XmacError("cpio: truncated name");
    let nameEnd = namesize;
    while (nameEnd > 0 && nameBuf[nameEnd - 1] === 0)
      nameEnd--;
    let name = dec.decode(nameBuf.subarray(0, nameEnd));
    if (align > 1)
      await skipN((align - offset % align) % align);
    if (name === "TRAILER!!!") {
      await skipN(filesize), sawTrailer = !0;
      continue;
    }
    let type = mode & S_IFMT, consumed = !1, linkTarget;
    if (type === S_IFLNK && filesize > 0 && filesize < 8192) {
      let t = await readExact(filesize);
      if (t === null)
        throw new XmacError("cpio: truncated symlink target");
      if (linkTarget = dec.decode(t), align > 1)
        await skipN((align - offset % align) % align);
      consumed = !0;
    }
    let entry = {
      path: name,
      mode,
      size: filesize,
      linkTarget,
      body: async function* () {
        if (consumed)
          return;
        consumed = !0;
        for await (let piece of reader.readStream(filesize))
          offset += piece.byteLength, yield piece;
        if (align > 1)
          await skipN((align - offset % align) % align);
      },
      skip: async () => {
        if (consumed)
          return;
        if (consumed = !0, await skipN(filesize), align > 1)
          await skipN((align - offset % align) % align);
      }
    };
    if (yield entry, !consumed)
      await entry.skip();
  }
}

// src/extract.ts
function newStats() {
  return { files: 0, dirs: 0, symlinks: 0, bytes: 0, sdkNames: [] };
}
async function splatPackage(pkgPath, outDir, copySymlinks, stats) {
  let xar = XarFile.open(pkgPath);
  try {
    let payload = xar.find("Payload");
    if (!payload) {
      let nested = xar.entries.find((e) => e.name.endsWith("/Payload"));
      if (!nested)
        throw new XmacError(`${path4.basename(pkgPath)}: no Payload entry found`);
      throw new XmacError(`${path4.basename(pkgPath)}: nested product archives are not supported yet (found ${nested.name})`);
    }
    let prog = new Progress(path4.basename(pkgPath), payload.size), sdkRoot = path4.join(outDir, "SDKs");
    fs4.mkdirSync(sdkRoot, { recursive: !0 });
    let PREFIX = /^\.?\/?Library\/Developer\/CommandLineTools\/SDKs\//, ALT_PREFIX = /^\.?\/?.*?\/SDKs\/(?=[A-Za-z0-9_.]+\.sdk(\/|$))/, deferredLinks = [], symlinkFailures = 0, rejected = 0, inside = (p) => p === sdkRoot || p.startsWith(sdkRoot + path4.sep), safeLink = (at, target) => target !== "" && !path4.isAbsolute(target) && inside(path4.resolve(path4.dirname(at), target));
    for await (let entry of cpioEntries(decompressPayload(xar.streamRaw(payload), (n) => prog.update(n)))) {
      let rel;
      if (PREFIX.test(entry.path))
        rel = entry.path.replace(PREFIX, "");
      else if (ALT_PREFIX.test(entry.path))
        rel = entry.path.replace(ALT_PREFIX, "");
      if (!rel || rel === "") {
        await entry.skip();
        continue;
      }
      let dest = path4.join(sdkRoot, rel);
      if (!inside(dest)) {
        rejected++, await entry.skip();
        continue;
      }
      let type = entry.mode & S_IFMT, m = /^([A-Za-z0-9_.+-]+\.sdk)$/.exec(rel.replace(/\/$/, ""));
      if (m && type === S_IFDIR && !stats.sdkNames.includes(m[1]))
        stats.sdkNames.push(m[1]);
      if (type === S_IFDIR)
        fs4.mkdirSync(dest, { recursive: !0 }), stats.dirs++;
      else if (type === S_IFLNK) {
        let target = entry.linkTarget ?? "";
        if (!safeLink(dest, target))
          rejected++;
        else if (copySymlinks)
          deferredLinks.push({ at: dest, target });
        else {
          fs4.mkdirSync(path4.dirname(dest), { recursive: !0 });
          try {
            fs4.rmSync(dest, { force: !0 });
          } catch {}
          try {
            fs4.symlinkSync(target, dest), stats.symlinks++;
          } catch {
            symlinkFailures++, deferredLinks.push({ at: dest, target });
          }
        }
      } else if (type === S_IFREG || type === 0) {
        fs4.mkdirSync(path4.dirname(dest), { recursive: !0 });
        let fd = fs4.openSync(dest, "w", entry.mode & 511 || 420);
        try {
          for await (let piece of entry.body()) {
            let off = 0;
            while (off < piece.byteLength)
              off += fs4.writeSync(fd, piece, off, piece.byteLength - off, -1);
          }
        } finally {
          fs4.closeSync(fd);
        }
        stats.files++, stats.bytes += entry.size;
      } else
        await entry.skip();
    }
    if (deferredLinks.length > 0) {
      let remaining = deferredLinks;
      for (let pass = 0;pass < 40 && remaining.length > 0; pass++) {
        let next = [];
        for (let l of remaining) {
          let resolved = path4.resolve(path4.dirname(l.at), l.target);
          if (!inside(resolved))
            continue;
          try {
            if (fs4.statSync(resolved).isDirectory())
              fs4.cpSync(resolved, l.at, { recursive: !0, dereference: !0 });
            else
              fs4.mkdirSync(path4.dirname(l.at), { recursive: !0 }), fs4.copyFileSync(resolved, l.at);
            stats.files++;
          } catch {
            next.push(l);
          }
        }
        if (next.length === remaining.length)
          break;
        remaining = next;
      }
      if (remaining.length > 0)
        note(`${remaining.length} symlink(s) could not be materialized (dangling targets)`);
    }
    if (symlinkFailures > 0)
      note(`${symlinkFailures} symlink(s) were materialized as copies because the filesystem rejected symlink creation`);
    if (rejected > 0)
      warn(`${rejected} entr${rejected === 1 ? "y" : "ies"} rejected for escaping the output directory (unexpected in a genuine Apple package)`);
    prog.finish();
  } finally {
    xar.close();
  }
}

// src/toolchain.ts
import * as fs5 from "fs";
import * as path5 from "path";
var ALL_ARCHS = ["arm64", "x86_64"];
function normalizeArch(a) {
  let k = a.trim().toLowerCase();
  if (k === "aarch64")
    return "arm64";
  if (k === "amd64")
    return "x86_64";
  if (k !== "arm64" && k !== "x86_64")
    throw new XmacError(`unsupported --arch '${a}' (use arm64 and/or x86_64)`);
  return k;
}
function cmakeToolchain(filePath, sdkRel, archs, minOs) {
  return `# Generated by xmac ${VERSION} \u2014 cross-compile to ${archs.join("/")} macOS from Linux.
#
#   cmake -B build -G Ninja --toolchain ${filePath}
#
# Requirements on the build host: clang and lld (for ld64.lld). Any
# clang >= 13 works; 15+ recommended. Override the compiler with
# -DXMAC_CLANG=/path/to/clang if the default is not what you want.

set(CMAKE_SYSTEM_NAME Darwin)
set(CMAKE_SYSTEM_PROCESSOR ${archs[0]})

get_filename_component(_xmac_root "\${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
set(XMAC_SDK "\${_xmac_root}/${sdkRel}" CACHE PATH "macOS SDK root")

set(CMAKE_OSX_SYSROOT "\${XMAC_SDK}" CACHE PATH "" FORCE)
set(CMAKE_OSX_ARCHITECTURES "${archs.join(";")}" CACHE STRING "" FORCE)
set(CMAKE_OSX_DEPLOYMENT_TARGET "${minOs}" CACHE STRING "" FORCE)
set(CMAKE_MACOSX_RPATH ON)

# Locate clang/lld. Prefer an explicit override, then PATH.
if(NOT XMAC_CLANG)
  find_program(XMAC_CLANG NAMES clang REQUIRED)
endif()
get_filename_component(_xmac_clang_dir "\${XMAC_CLANG}" DIRECTORY)
if(NOT XMAC_CLANGXX)
  find_program(XMAC_CLANGXX NAMES clang++ HINTS "\${_xmac_clang_dir}" REQUIRED)
endif()
if(NOT XMAC_LLD)
  find_program(XMAC_LLD NAMES ld64.lld HINTS "\${_xmac_clang_dir}")
endif()
if(NOT XMAC_LLD)
  message(FATAL_ERROR "xmac: ld64.lld not found \u2014 install lld (apt-get install lld / brew install llvm)")
endif()

set(CMAKE_C_COMPILER   "\${XMAC_CLANG}")
set(CMAKE_CXX_COMPILER "\${XMAC_CLANGXX}")
set(CMAKE_OBJC_COMPILER  "\${XMAC_CLANG}")
set(CMAKE_OBJCXX_COMPILER "\${XMAC_CLANGXX}")
set(CMAKE_ASM_COMPILER "\${XMAC_CLANG}")

# A non-Apple clang defaults to the *build host's* triple; -arch alone is not
# enough to retarget it. CMake appends --target=<this> to every compile.
foreach(_lang C CXX OBJC OBJCXX ASM)
  set(CMAKE_\${_lang}_COMPILER_TARGET "${archs[0]}-apple-macosx${minOs}")
endforeach()

# Use LLVM binutils when available so ranlib/ar understand Mach-O + fat files.
find_program(XMAC_AR NAMES llvm-ar HINTS "\${_xmac_clang_dir}")
find_program(XMAC_RANLIB NAMES llvm-ranlib HINTS "\${_xmac_clang_dir}")
find_program(XMAC_LIPO NAMES llvm-lipo HINTS "\${_xmac_clang_dir}")
find_program(XMAC_NM NAMES llvm-nm HINTS "\${_xmac_clang_dir}")
find_program(XMAC_STRIP NAMES llvm-strip HINTS "\${_xmac_clang_dir}")
find_program(XMAC_INSTALL_NAME_TOOL NAMES llvm-install-name-tool HINTS "\${_xmac_clang_dir}")
foreach(_t AR RANLIB NM STRIP)
  if(XMAC_\${_t})
    set(CMAKE_\${_t} "\${XMAC_\${_t}}" CACHE FILEPATH "" FORCE)
  endif()
endforeach()
if(XMAC_INSTALL_NAME_TOOL)
  set(CMAKE_INSTALL_NAME_TOOL "\${XMAC_INSTALL_NAME_TOOL}" CACHE FILEPATH "" FORCE)
endif()

# clang's Darwin driver invokes a system linker. Ask for the lld *flavor*
# (so the driver emits modern -platform_version arguments rather than the
# legacy flags ld64.lld no longer accepts) and add the directory containing
# ld64.lld as a program-search prefix so it is found even when it does not
# sit next to clang.
get_filename_component(_xmac_lld_dir "\${XMAC_LLD}" DIRECTORY)
# Plain set() rather than append: toolchain files are included several times
# per configure and appends would accumulate duplicates.
set(CMAKE_EXE_LINKER_FLAGS_INIT    "-fuse-ld=lld -B\${_xmac_lld_dir}")
set(CMAKE_SHARED_LINKER_FLAGS_INIT "-fuse-ld=lld -B\${_xmac_lld_dir}")
set(CMAKE_MODULE_LINKER_FLAGS_INIT "-fuse-ld=lld -B\${_xmac_lld_dir}")

# Use the SDK's libc++ headers, not the host clang's own copy (which targets
# the build machine and lacks a usable __config_site for Darwin). These are
# *_INIT variables: the project and the user can still append or override.
set(CMAKE_CXX_FLAGS_INIT    "-stdlib++-isystem \${XMAC_SDK}/usr/include/c++/v1")
set(CMAKE_OBJCXX_FLAGS_INIT "-stdlib++-isystem \${XMAC_SDK}/usr/include/c++/v1")

# Search only the SDK, never the build host's headers/libraries.
set(CMAKE_FIND_ROOT_PATH "\${XMAC_SDK}")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

set(CMAKE_FRAMEWORK_PATH "\${XMAC_SDK}/System/Library/Frameworks")
`;
}
function emitToolchain(outDir, sdkName, archs, minOs) {
  let sdkRel = `SDKs/${sdkName}`, binDir = path5.join(outDir, "bin");
  fs5.mkdirSync(binDir, { recursive: !0 });
  let cmakeAll = [], writeCmake = (fileName, fileArchs) => {
    let p = path5.join(outDir, fileName);
    return fs5.writeFileSync(p, cmakeToolchain(p, sdkRel, fileArchs, minOs)), cmakeAll.push(p), p;
  }, cmakePath = "";
  for (let arch of ALL_ARCHS) {
    let p = writeCmake(`${arch}-apple-darwin.toolchain.cmake`, [arch]);
    if (archs[0] === arch)
      cmakePath = p;
  }
  if (archs.length > 1)
    cmakePath = writeCmake("universal-apple-darwin.toolchain.cmake", archs);
  let primaryArch = archs[0], archFlags = archs.map((a) => `-arch ${a}`).join(" "), envPath = path5.join(outDir, "env.sh"), env = `# Generated by xmac ${VERSION} \u2014 source this for non-CMake builds.
#
#   source ${envPath}
#   $CC -o hello hello.c
#
# Works with make, ninja (via CC/CXX in your generator), autotools
# (./configure --host=${primaryArch}-apple-darwin), cargo (see below), etc.

_xmac_root="$(cd "$(dirname "\${BASH_SOURCE[0]:-$0}")" && pwd)"
export SDKROOT="$_xmac_root/${sdkRel}"
export MACOSX_DEPLOYMENT_TARGET="${minOs}"

_xmac_lld="$(command -v ld64.lld || true)"
if [ -z "$_xmac_lld" ]; then
  echo "xmac: warning: ld64.lld not found on PATH; linking will fail (install lld)" >&2
fi

export XMAC_CFLAGS="--sysroot=$SDKROOT ${archFlags} -mmacosx-version-min=${minOs}"
export XMAC_CXXFLAGS="$XMAC_CFLAGS -stdlib++-isystem $SDKROOT/usr/include/c++/v1"
export XMAC_LDFLAGS="-fuse-ld=lld -B$(dirname "\${_xmac_lld:-/usr/bin/ld64.lld}") -Wl,-syslibroot,$SDKROOT"

export CC="$_xmac_root/bin/${primaryArch}-apple-darwin-cc"
export CXX="$_xmac_root/bin/${primaryArch}-apple-darwin-c++"
export AR="$(command -v llvm-ar || command -v ar)"
export RANLIB="$(command -v llvm-ranlib || command -v ranlib)"

# Cargo / Rust convenience (requires \`rustup target add <triple>-apple-darwin\`):
${archs.map((a) => {
    let rustArch = a === "arm64" ? "aarch64" : a;
    return `export CARGO_TARGET_${rustArch.toUpperCase()}_APPLE_DARWIN_LINKER="$_xmac_root/bin/${a}-apple-darwin-cc"
export CC_${rustArch}_apple_darwin="$_xmac_root/bin/${a}-apple-darwin-cc"
export CXX_${rustArch}_apple_darwin="$_xmac_root/bin/${a}-apple-darwin-c++"`;
  }).join(`
`)}
`;
  fs5.writeFileSync(envPath, env);
  let wrappers = [];
  for (let arch of ALL_ARCHS)
    for (let [tool, driver] of [
      ["cc", "clang"],
      ["c++", "clang++"]
    ]) {
      let isCxx = tool === "c++", wrapper = `#!/bin/sh
# Generated by xmac ${VERSION}. Cross-compile ${isCxx ? "C++/ObjC++" : "C/ObjC"} to ${arch}-apple-macosx.
here="$(cd "$(dirname "$0")/.." && pwd)"
sdk="$here/${sdkRel}"
lld="\${XMAC_LLD:-$(command -v ld64.lld)}"
if [ -z "$lld" ]; then
  echo "xmac: ld64.lld not found on PATH (install lld)" >&2
  exit 1
fi
exec "\${XMAC_${driver === "clang" ? "CLANG" : "CLANGXX"}:-${driver}}" \\
  --target=${arch}-apple-macosx\${MACOSX_DEPLOYMENT_TARGET:-${minOs}} \\
  -isysroot "$sdk" \\
  -fuse-ld=lld \\
  -B "$(dirname "$lld")" \\
  -Wl,-syslibroot,"$sdk" \\${isCxx ? `
  -stdlib++-isystem "$sdk/usr/include/c++/v1" \\` : ""}
  "$@"
`, p = path5.join(binDir, `${arch}-apple-darwin-${tool}`);
      fs5.writeFileSync(p, wrapper), fs5.chmodSync(p, 493), wrappers.push(p);
    }
  return { cmake: cmakePath, cmakeAll, env: envPath, wrappers };
}

// src/commands.ts
var LICENSE_NOTICE = `The macOS SDK is licensed by Apple Inc. under the "macOS SDK and Xcode
Agreement" (and, for SDKs obtained through Xcode, the Xcode and Apple SDKs
Agreement). xmac downloads the SDK directly from Apple's servers to *this*
machine \u2014 it does not redistribute anything \u2014 but by extracting and using the
SDK you are agreeing to Apple's license terms, which notably restrict the SDK
to developing software for Apple platforms and prohibit redistributing the SDK
itself (e.g. do not commit the extracted SDK to a public repository or bake it
into a public container image).

View the full text with \`xmac license --release <ver>\` or at:
  https://www.apple.com/legal/sla/

Pass --accept-license to proceed.`;
function checkLicense(accepted) {
  if (accepted)
    return;
  if (process.stderr.write(LICENSE_NOTICE + `
`), process.stdin.isTTY && process.stderr.isTTY) {
    let answer = prompt(`
Do you accept the license terms? [y/N]`);
    if (answer && /^y(es)?$/i.test(answer.trim()))
      return;
    die("license not accepted");
  }
  die("pass --accept-license to accept Apple's license terms non-interactively");
}
async function cmdList(opts, refresh) {
  let manifest = await getManifest(opts, refresh);
  if (opts.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  console.log(c.bold("Command Line Tools releases from Apple's software-update catalog")), console.log(c.dim(`catalog fetched ${manifest.fetchedAt}`)), console.log("");
  let rows = [["CLT", "RELEASED", "PRODUCT", "SDKS"]];
  for (let r of manifest.releases) {
    let sdks = r.sdkPackages.map((s) => `${interactive ? c.cyan(s.sdkName?.replace(/\.sdk$/, "") ?? s.fileName) : s.sdkName?.replace(/\.sdk$/, "") ?? s.fileName} ${c.dim(`(${humanSize(s.size)})`)}`).join(", ");
    rows.push([r.version, r.postDate, r.productId, sdks]);
  }
  table(rows), console.log(""), console.log(c.dim("Use `xmac splat --accept-license --sdk <version>` to fetch one."));
}
async function cmdLicense(opts, releaseSpec) {
  let manifest = await getManifest(opts);
  if (manifest.releases.length === 0)
    die("no Command Line Tools releases found in the catalog");
  let release = releaseSpec ? selectSdks(manifest, "all", releaseSpec).release : manifest.releases[0], text = await fetchDistribution(release), m = /<license[^>]*>([\s\S]*?)<\/license>/.exec(text);
  if (!m)
    die("could not locate the license text in the distribution file");
  let plain = decodeEntities(m[1]).replace(/\{\\(?:fonttbl|colortbl|\*\\[a-z]+)[^{}]*\}/g, "").replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\par[d]?\b/g, `
`).replace(/\\tab\b/g, "\t").replace(/\\[a-zA-Z]+-?\d* ?/g, "").replace(/[{}]/g, "").replace(/^[\s;]+/, "").replace(/\n{3,}/g, `

`).trim();
  console.log(c.bold(`# License for ${displayName(release)}`)), console.log(""), console.log(plain);
}
function pkgCachePath(opts, release, pkg) {
  return path6.join(opts.cacheDir, "dl", release.productId, pkg.fileName);
}
async function cmdDownload(opts, sel) {
  let paths = [];
  status(`Downloading ${sel.packages.length} package(s) for ${displayName(sel.release)}`);
  for (let pkg of sel.packages) {
    let dest = pkgCachePath(opts, sel.release, pkg);
    if (opts.offline) {
      if (!fs6.existsSync(dest))
        throw new XmacError(`--offline: ${dest} is not in the cache`);
    } else
      await downloadTo(pkg.url, dest, pkg.size, void 0, `${pkg.sdkName ?? pkg.fileName}`);
    paths.push(dest);
  }
  return paths;
}
async function cmdUnpack(opts, sel) {
  let pkgPaths = await cmdDownload(opts, sel), results = [];
  for (let p of pkgPaths) {
    let dest = p.replace(/\.pkg$/i, "") + ".unpacked";
    fs6.mkdirSync(dest, { recursive: !0 });
    let stats = newStats();
    status(`Unpacking ${path6.basename(p)}`), await splatPackage(p, dest, !1, stats), ok(`${path6.basename(p)}: ${thousands(stats.files)} files, ${humanSize(stats.bytes)} (${stats.sdkNames.join(", ") || "no SDK found"})`);
    for (let n of stats.sdkNames)
      results.push([n.replace(/\.sdk$/, ""), path6.join(dest, "SDKs", n)]);
  }
  result(results.map(([k, v]) => [`sdk-path[${k}]`, v]));
}
function readSdkSettings(outDir, sdkName) {
  try {
    let s = JSON.parse(fs6.readFileSync(path6.join(outDir, "SDKs", sdkName, "SDKSettings.json"), "utf8"));
    return { display: s.DisplayName, version: s.Version };
  } catch {
    return {};
  }
}
async function cmdSplat(opts, sel, splat) {
  let pkgPaths = await cmdDownload(opts, sel), outDir = path6.resolve(splat.output);
  fs6.mkdirSync(outDir, { recursive: !0 });
  let stats = newStats();
  status(`Extracting into ${outDir}`);
  for (let p of pkgPaths)
    await splatPackage(p, outDir, splat.copySymlinks, stats);
  if (stats.sdkNames.length === 0)
    throw new XmacError("no MacOSX*.sdk directory was found in the package payload(s)");
  let named = stats.sdkNames.map((n) => ({ n, v: /MacOSX(\d+(?:\.\d+)*)\.sdk/i.exec(n)?.[1] })).sort((a, b) => compareVersions(b.v ?? "0", a.v ?? "0")), mainSdk = named[0].n, emitted;
  if (!splat.sdkOnly)
    emitted = emitToolchain(outDir, mainSdk, splat.archs, splat.minOs);
  for (let { n, v } of named) {
    if (!v)
      continue;
    let major = v.split(".")[0];
    for (let alias of [`MacOSX${major}.sdk`, "MacOSX.sdk"]) {
      let aliasPath = path6.join(outDir, "SDKs", alias);
      if (!fs6.existsSync(aliasPath) && !stats.sdkNames.includes(alias))
        try {
          fs6.symlinkSync(n, aliasPath);
        } catch {}
    }
  }
  let settings = readSdkSettings(outDir, mainSdk);
  if (ok(`${c.bold(mainSdk)}${settings.display ? ` ${c.dim(`(${settings.display})`)}` : ""} \u2014 ${thousands(stats.files)} files, ${thousands(stats.dirs)} directories, ${thousands(stats.symlinks)} symlinks, ${humanSize(stats.bytes)}`), interactive)
    console.log("");
  let pairs = [];
  for (let { n } of named) {
    let s = readSdkSettings(outDir, n);
    if (pairs.push([named.length > 1 ? `sdk[${n}]` : "sdk", n]), s.version)
      pairs.push([named.length > 1 ? `sdk-version[${n}]` : "sdk-version", s.version]);
  }
  if (pairs.push(["sdk-path", path6.join(outDir, "SDKs", mainSdk)]), pairs.push(["sdk-root", path6.join(outDir, "SDKs")]), emitted)
    pairs.push(["toolchain-cmake", emitted.cmake]), pairs.push(["env-script", emitted.env]), pairs.push(["cc", path6.join(outDir, "bin", `${splat.archs[0]}-apple-darwin-cc`)]), pairs.push(["cxx", path6.join(outDir, "bin", `${splat.archs[0]}-apple-darwin-c++`)]);
  if (pairs.push(["files", String(stats.files)]), pairs.push(["bytes", String(stats.bytes)]), result(pairs), interactive)
    console.log(""), console.log(c.bold("Cross-compile with CMake:")), console.log(c.dim(`  cmake -B build -G Ninja --toolchain ${emitted?.cmake ?? `<output>/${splat.archs[0]}-apple-darwin.toolchain.cmake`}`)), console.log(c.bold("Or anything else (make, ninja, cargo, ./configure):")), console.log(c.dim(`  source ${emitted?.env ?? "<output>/env.sh"} && $CC -o hello hello.c`)), console.log(c.bold("Or directly:")), console.log(c.dim(`  clang --target=${splat.archs[0]}-apple-macosx${splat.minOs} -isysroot ${path6.join(outDir, "SDKs", mainSdk)} -fuse-ld=lld ...`));
}

// src/main.ts
var HELP = `xmac ${VERSION}
Download and extract macOS SDKs from Apple's public CDN for cross-compilation.

USAGE:
  xmac [GLOBAL OPTIONS] <COMMAND> [OPTIONS]

COMMANDS:
  list      List Command Line Tools releases and the SDKs they contain
  download  Download SDK package(s) into the cache
  unpack    Download + extract package payloads into the cache
  splat     Download + unpack + emit an SDK and cross-compilation toolchain
  license   Print Apple's license terms for a release
  clean     Remove the cache directory

GLOBAL OPTIONS:
  --cache-dir <DIR>     Cache directory [default: ./.xmac-cache]
  --catalog <URL>       Apple software-update catalog URL to use
  --offline             Never hit the network; fail if the cache is missing
  --json                Machine-readable output (list)
  -q, --quiet           Suppress progress output
  -h, --help            Show this help
  -V, --version         Show version

SELECTION OPTIONS (download / unpack / splat):
  --sdk <SPEC>          Which SDK to fetch. One of:
                          latest          newest SDK available (default)
                          <major[.minor]> e.g. "15", "15.2", "MacOSX14.5"
                          all             every SDK in the chosen release
  --release <VER|ID>    Pin a Command Line Tools release (e.g. "16.2" or a
                        product id like "072-44426") instead of searching all
  --accept-license      Accept Apple's license terms non-interactively.
                        Required in CI. See \`xmac license\`.

SPLAT OPTIONS:
  --output <DIR>        Output directory [default: ./xmac-sdk]
  --arch <LIST>         Default target arch for the toolchain files: arm64,
                        x86_64, or arm64,x86_64 for universal binaries
                        [default: arm64]. Wrapper scripts for every arch are
                        always emitted; this only sets the default.
  --min-os <VER>        Deployment target baked into toolchain files
                        [default: 11.0]
  --sdk-only            Only emit the .sdk directory, no toolchain files
  --copy-symlinks       Materialize symlinks as file copies (for filesystems
                        or tools that cannot handle symlinks)

OUTPUT:
  Progress and status go to stderr. Final results go to stdout as stable
  \`key: value\` lines when stdout is not a terminal, e.g.:
      SDKROOT=$(xmac splat --accept-license -q | awk '/^sdk-path:/{print $2}')

EXAMPLES:
  # See what Apple is currently serving
  xmac list

  # CI one-liner: newest SDK + toolchain into ./xmac-sdk
  xmac splat --accept-license

  # A specific SDK, universal toolchain
  xmac splat --accept-license --sdk 14 --arch arm64,x86_64 --output /opt/mac

  # Then cross-compile:
  cmake -B build -G Ninja --toolchain /opt/mac/arm64-apple-darwin.toolchain.cmake
  # ...or without CMake:
  source /opt/mac/env.sh && $CC hello.c -o hello
`, FLAGS_WITH_VALUES = /* @__PURE__ */ new Set([
  "--cache-dir",
  "--catalog",
  "--sdk",
  "--release",
  "--output",
  "--arch",
  "--min-os"
]), KNOWN_BOOL_FLAGS = /* @__PURE__ */ new Set([
  "--offline",
  "--json",
  "--quiet",
  "-q",
  "--help",
  "-h",
  "--version",
  "-V",
  "--accept-license",
  "--sdk-only",
  "--copy-symlinks",
  "--preserve-symlinks",
  "--refresh"
]);
function parseArgs(argv) {
  let out = { flags: /* @__PURE__ */ new Map, positional: [] };
  for (let i = 0;i < argv.length; i++) {
    let a = argv[i];
    if (a === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      let eq = a.indexOf("=");
      if (eq !== -1) {
        let key = a.slice(0, eq);
        if (!FLAGS_WITH_VALUES.has(key))
          die(`unknown option '${key}'. Run \`xmac --help\`.`);
        out.flags.set(key, a.slice(eq + 1));
        continue;
      }
      if (FLAGS_WITH_VALUES.has(a)) {
        let v = argv[++i];
        if (v === void 0)
          die(`${a} requires a value`);
        out.flags.set(a, v);
      } else if (KNOWN_BOOL_FLAGS.has(a))
        out.flags.set(a, !0);
      else
        die(`unknown option '${a}'. Run \`xmac --help\`.`);
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      if (!KNOWN_BOOL_FLAGS.has(a))
        die(`unknown option '${a}'. Run \`xmac --help\`.`);
      out.flags.set(a, !0);
      continue;
    }
    if (!out.command)
      out.command = a;
    else
      out.positional.push(a);
  }
  return out;
}
async function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.flags.has("-V") || args.flags.has("--version")) {
    console.log(`xmac ${VERSION}`);
    return;
  }
  if (args.flags.has("-h") || args.flags.has("--help") || !args.command) {
    console.log(HELP);
    return;
  }
  setQuiet(Boolean(args.flags.get("-q") || args.flags.get("--quiet")));
  let opts = {
    cacheDir: path7.resolve(String(args.flags.get("--cache-dir") ?? process.env.XMAC_CACHE_DIR ?? "./.xmac-cache")),
    catalog: String(args.flags.get("--catalog") ?? process.env.XMAC_CATALOG ?? DEFAULT_SUCATALOG),
    offline: Boolean(args.flags.get("--offline")),
    json: Boolean(args.flags.get("--json"))
  };
  if (!["list", "download", "unpack", "splat", "clean", "license"].includes(args.command))
    die(`unknown command '${args.command}'. Run \`xmac --help\`.`);
  if (args.command === "clean") {
    fs7.rmSync(opts.cacheDir, { recursive: !0, force: !0 }), log(`removed ${opts.cacheDir}`);
    return;
  }
  if (args.command === "list") {
    await cmdList(opts, Boolean(args.flags.get("--refresh")));
    return;
  }
  if (args.command === "license") {
    await cmdLicense(opts, args.flags.get("--release") ?? args.positional[0]);
    return;
  }
  checkLicense(Boolean(args.flags.get("--accept-license")));
  let manifest = await getManifest(opts), sel = selectSdks(manifest, String(args.flags.get("--sdk") ?? "latest"), args.flags.get("--release"));
  if (status(`Selected ${displayName(sel.release)} (${sel.release.productId}, ${sel.release.postDate}): ${sel.packages.map((p) => p.sdkName ?? p.fileName).join(", ")}`), args.command === "download") {
    await cmdDownload(opts, sel);
    return;
  }
  if (args.command === "unpack") {
    await cmdUnpack(opts, sel);
    return;
  }
  if (args.command === "splat") {
    let archs = String(args.flags.get("--arch") ?? "arm64").split(",").filter((a) => a.trim() !== "").map(normalizeArch);
    if (archs.length === 0)
      die("--arch requires at least one architecture");
    await cmdSplat(opts, sel, {
      output: String(args.flags.get("--output") ?? "./xmac-sdk"),
      archs: [...new Set(archs)],
      minOs: String(args.flags.get("--min-os") ?? "11.0"),
      sdkOnly: Boolean(args.flags.get("--sdk-only")),
      copySymlinks: Boolean(args.flags.get("--copy-symlinks"))
    });
    return;
  }
}
function run() {
  main().catch((e) => {
    if (e instanceof XmacError)
      die(e.message);
    console.error(e), process.exit(1);
  });
}

// xmac.ts
run();
