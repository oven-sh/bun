import { lines, type Program } from "./program";

const scaffold = [
  'import fs from "node:fs";',
  'import { tmpdir } from "node:os";',
  'import { join } from "node:path";',
  'const folder = fs.mkdtempSync(join(tmpdir(), "built-ins-alone-"));',
  'const file = join(folder, "file.txt");',
  'fs.writeFileSync(file, "hello");',
];
const cleanup = "fs.rmSync(folder, { recursive: true });";
const indent = (text: string[]) => text.map(line => `  ${line}`);

interface Operation {
  name: string;
  words?: string;
  before?: string[];
  passed: string;
  uses: string[];
  forms?: ("sync" | "callback" | "promise")[];
  more?: string;
}

const nothing = ["console.log(result === undefined);"];
const stats = [
  "console.log(result.isFile(), result.isDirectory(), result.size + 1, typeof result.mtimeMs, result.mtime instanceof Date, typeof result.mode);",
];
const opened = ['const descriptor = fs.openSync(file, "r+");'];
const closes = ["fs.closeSync(descriptor);"];
const withoutPromise: Operation["forms"] = ["sync", "callback"];

const operations: Operation[] = [
  {
    name: "readFile",
    words: "as-text",
    passed: 'file, "utf8"',
    uses: ["console.log(typeof result, result.length, result);"],
  },
  {
    name: "readFile",
    words: "as-bytes",
    passed: "file",
    uses: ["console.log(result instanceof Buffer, result.length + 1, result[0] + 1, result[9] === undefined);"],
  },
  {
    name: "readFile",
    words: "with-an-encoding-in-its-options",
    passed: 'file, { encoding: "hex" }',
    uses: ["console.log(typeof result, result.length);"],
  },
  {
    name: "writeFile",
    passed: 'file, "more text"',
    uses: [...nothing, 'console.log(fs.readFileSync(file, "utf8").length);'],
  },
  {
    name: "writeFile",
    words: "with-bytes",
    passed: "file, new Uint8Array([104, 105])",
    uses: [...nothing, 'console.log(fs.readFileSync(file, "utf8"));'],
  },
  { name: "appendFile", passed: 'file, "!"', uses: [...nothing, 'console.log(fs.readFileSync(file, "utf8"));'] },
  { name: "stat", passed: "file", uses: stats },
  {
    name: "stat",
    words: "of-a-folder",
    passed: "folder",
    uses: ["console.log(result.isFile(), result.isDirectory(), result.isSymbolicLink());"],
  },
  {
    name: "stat",
    words: "with-big-integers",
    passed: "file, { bigint: true }",
    uses: ["console.log(typeof result.size, result.size + 1n, typeof result.mtimeNs);"],
  },
  { name: "lstat", passed: "file", uses: stats },
  { name: "fstat", before: opened, passed: "descriptor", uses: [...stats, ...closes], forms: withoutPromise },
  {
    name: "statfs",
    passed: "folder",
    uses: ["console.log(typeof result.bsize, typeof result.blocks, typeof result.type);"],
  },
  { name: "access", passed: "file", uses: nothing },
  {
    name: "readdir",
    passed: "folder",
    uses: [
      "console.log(Array.isArray(result), result.length, typeof result[0], result[0].length, result[0], result[1] === undefined);",
    ],
  },
  {
    name: "readdir",
    words: "with-file-types",
    passed: "folder, { withFileTypes: true }",
    uses: [
      "console.log(result.length, result[0] instanceof fs.Dirent, result[0].name, result[0].isFile(), result[0].isDirectory());",
    ],
  },
  {
    name: "readdir",
    words: "of-an-empty-folder",
    before: ['const empty = join(folder, "empty");', "fs.mkdirSync(empty);"],
    passed: "empty",
    uses: ["console.log(Array.isArray(result), result.length, result[0] === undefined);"],
  },
  {
    name: "mkdir",
    passed: 'join(folder, "made")',
    uses: [...nothing, 'console.log(fs.existsSync(join(folder, "made")));'],
  },
  {
    name: "mkdir",
    words: "with-its-parents",
    passed: 'join(folder, "a", "b"), { recursive: true }',
    uses: ['console.log(typeof result, result.endsWith("a"));'],
  },
  {
    name: "mkdir",
    words: "of-a-folder-that-exists",
    passed: "folder, { recursive: true }",
    uses: ["console.log(result === undefined, typeof result);"],
  },
  {
    name: "mkdtemp",
    passed: 'join(folder, "made-")',
    uses: ["console.log(typeof result, result.length > folder.length, fs.existsSync(result));"],
  },
  {
    name: "rename",
    passed: 'file, join(folder, "renamed.txt")',
    uses: [...nothing, "console.log(fs.existsSync(file));"],
  },
  {
    name: "copyFile",
    passed: 'file, join(folder, "copy.txt")',
    uses: [...nothing, 'console.log(fs.readFileSync(join(folder, "copy.txt"), "utf8").length);'],
  },
  {
    name: "cp",
    passed: 'file, join(folder, "copy.txt")',
    uses: [...nothing, 'console.log(fs.existsSync(join(folder, "copy.txt")));'],
  },
  {
    name: "link",
    passed: 'file, join(folder, "link.txt")',
    uses: [...nothing, "console.log(fs.statSync(file).nlink + 1);"],
  },
  {
    name: "symlink",
    passed: 'file, join(folder, "link.txt")',
    uses: [...nothing, 'console.log(fs.lstatSync(join(folder, "link.txt")).isSymbolicLink());'],
  },
  {
    name: "readlink",
    before: ['fs.symlinkSync(file, join(folder, "link.txt"));'],
    passed: 'join(folder, "link.txt")',
    uses: ["console.log(typeof result, result === file);"],
  },
  {
    name: "realpath",
    passed: 'join(folder, ".", "file.txt")',
    uses: ['console.log(typeof result, result.endsWith("file.txt"));'],
  },
  { name: "unlink", passed: "file", uses: [...nothing, "console.log(fs.existsSync(file));"] },
  { name: "rm", passed: "file", uses: [...nothing, "console.log(fs.existsSync(file));"] },
  {
    name: "rmdir",
    before: ['fs.mkdirSync(join(folder, "made"));'],
    passed: 'join(folder, "made")',
    uses: [...nothing, 'console.log(fs.existsSync(join(folder, "made")));'],
  },
  { name: "truncate", passed: "file, 2", uses: [...nothing, 'console.log(fs.readFileSync(file, "utf8"));'] },
  {
    name: "chmod",
    passed: "file, 0o600",
    uses: [...nothing, "console.log((fs.statSync(file).mode & 0o777).toString(8));"],
  },
  { name: "chown", passed: "file, process.getuid?.() ?? 0, process.getgid?.() ?? 0", uses: nothing },
  { name: "lchown", passed: "file, process.getuid?.() ?? 0, process.getgid?.() ?? 0", uses: nothing },
  { name: "utimes", passed: "file, 1, 2", uses: [...nothing, "console.log(fs.statSync(file).mtimeMs);"] },
  { name: "lutimes", passed: "file, 1, 2", uses: [...nothing, "console.log(fs.lstatSync(file).mtimeMs);"] },
  {
    name: "open",
    passed: 'file, "r"',
    uses: ["console.log(typeof result, result > 2);", "fs.closeSync(result);"],
    forms: withoutPromise,
  },
  { name: "close", before: opened, passed: "descriptor", uses: nothing, forms: withoutPromise },
  {
    name: "read",
    before: [...opened, "const bytes = Buffer.alloc(8);"],
    passed: "descriptor, bytes, 0, 5, 0",
    uses: ["console.log(typeof result, result + 1, bytes[0] + 1, bytes[5]);", ...closes],
    forms: withoutPromise,
    more: "buffer",
  },
  {
    name: "write",
    before: opened,
    passed: 'descriptor, "HE"',
    uses: ["console.log(typeof result, result + 1);", ...closes, 'console.log(fs.readFileSync(file, "utf8"));'],
    forms: withoutPromise,
    more: "text",
  },
  {
    name: "readv",
    before: [...opened, "const parts = [Buffer.alloc(2), Buffer.alloc(2)];"],
    passed: "descriptor, parts, 0",
    uses: ["console.log(typeof result, result + 1, parts[1].toString());", ...closes],
    forms: withoutPromise,
  },
  {
    name: "writev",
    before: opened,
    passed: 'descriptor, [Buffer.from("H"), Buffer.from("E")], 0',
    uses: ["console.log(typeof result, result + 1);", ...closes, 'console.log(fs.readFileSync(file, "utf8"));'],
    forms: withoutPromise,
  },
  { name: "fsync", before: opened, passed: "descriptor", uses: [...nothing, ...closes], forms: withoutPromise },
  { name: "fdatasync", before: opened, passed: "descriptor", uses: [...nothing, ...closes], forms: withoutPromise },
  {
    name: "ftruncate",
    before: opened,
    passed: "descriptor, 2",
    uses: [...nothing, ...closes, 'console.log(fs.readFileSync(file, "utf8"));'],
    forms: withoutPromise,
  },
  {
    name: "futimes",
    before: opened,
    passed: "descriptor, 1, 2",
    uses: [...nothing, ...closes, "console.log(fs.statSync(file).mtimeMs);"],
    forms: withoutPromise,
  },
  { name: "fchmod", before: opened, passed: "descriptor, 0o600", uses: [...nothing, ...closes], forms: withoutPromise },
  {
    name: "fchown",
    before: opened,
    passed: "descriptor, process.getuid?.() ?? 0, process.getgid?.() ?? 0",
    uses: [...nothing, ...closes],
    forms: withoutPromise,
  },
];

const kebab = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

function fileSystemPrograms(): Program[] {
  const programs: Program[] = [];
  for (const { name, words, before, passed, uses, forms, more } of operations) {
    const suffix = words === undefined ? "" : `-${words}`;
    for (const form of forms ?? ["sync", "callback", "promise"]) {
      if (form === "sync") {
        programs.push({
          name: `fs-${kebab(name)}-sync${suffix}`,
          rows: [`%NodeJSFS%.prototype.${name}Sync`],
          text: lines(scaffold, before, `const result = fs.${name}Sync(${passed});`, uses, cleanup),
        });
      } else if (form === "promise") {
        programs.push({
          name: `fs-promises-${kebab(name)}${suffix}`,
          rows: [`%NodeJSFS%.prototype.${name}`],
          text: lines(scaffold, before, `const result = await fs.promises.${name}(${passed});`, uses, cleanup),
        });
      } else {
        programs.push({
          name: `fs-${kebab(name)}-with-a-callback${suffix}`,
          rows: [`%NodeJSFS%.prototype.${name}Cb`],
          text: lines(
            scaffold,
            before,
            `fs.${name}(${passed}, function (error, result${more === undefined ? "" : `, ${more}`}) {`,
            indent([
              `console.log(error === null, arguments.length${more === undefined ? "" : `, typeof ${more}`});`,
              ...uses,
              cleanup,
            ]),
            "});",
          ),
        });
      }
    }
  }
  return programs;
}

const missing = 'join(folder, "missing.txt")';
const failure = [
  "console.log(error instanceof Error, error.code, typeof error.errno, error.syscall, typeof error.path, typeof error.message);",
];

const others: [string, string[], string[]][] = [
  [
    "fs-read-file-sync-of-a-missing-file-throws",
    ["%NodeJSFS%.prototype.readFileSync"],
    [...scaffold, "try {", `  fs.readFileSync(${missing});`, "} catch (error) {", ...indent(failure), "}", cleanup],
  ],
  [
    "fs-read-file-with-a-callback-of-a-missing-file-passes-the-error",
    ["%NodeJSFS%.prototype.readFileCb"],
    [
      ...scaffold,
      `fs.readFile(${missing}, (error, result) => {`,
      ...indent(failure),
      "  console.log(result === undefined);",
      `  ${cleanup}`,
      "});",
    ],
  ],
  [
    "fs-promises-read-file-of-a-missing-file-rejects",
    ["%NodeJSFS%.prototype.readFile"],
    [
      ...scaffold,
      "try {",
      `  await fs.promises.readFile(${missing});`,
      "} catch (error) {",
      ...indent(failure),
      "}",
      cleanup,
    ],
  ],
  [
    "fs-access-sync-of-a-missing-file-throws",
    ["%NodeJSFS%.prototype.accessSync"],
    [...scaffold, "try {", `  fs.accessSync(${missing});`, "} catch (error) {", ...indent(failure), "}", cleanup],
  ],
  [
    "fs-stat-sync-of-a-missing-file-answers-undefined-when-told-not-to-throw",
    ["%NodeJSFS%.prototype.statSync"],
    [
      ...scaffold,
      `const result = fs.statSync(${missing}, { throwIfNoEntry: false });`,
      "console.log(result === undefined, typeof result);",
      cleanup,
    ],
  ],
  [
    "fs-exists-sync-answers-true-or-false",
    ["%NodeJSFS%.prototype.existsSync"],
    [...scaffold, `console.log(fs.existsSync(file), fs.existsSync(${missing}), fs.existsSync(undefined));`, cleanup],
  ],
  [
    "fs-exists-with-a-callback-passes-only-the-answer",
    ["%NodeJSFS%.prototype.existsCb"],
    [
      ...scaffold,
      "fs.exists(file, function (result) {",
      "  console.log(result, arguments.length);",
      `  ${cleanup}`,
      "});",
    ],
  ],
  [
    "fs-promises-exists-settles-with-the-answer",
    ["%NodeJSFS%.prototype.exists"],
    [...scaffold, `console.log(await fs.promises.exists(file), await fs.promises.exists(${missing}));`, cleanup],
  ],
  [
    "fs-realpath-native-answers-text",
    ["%NodeJSFS%.prototype.realpathNativeSync", "%NodeJSFS%.prototype.realpathNativeCb"],
    [
      ...scaffold,
      'console.log(fs.realpathSync.native(file).endsWith("file.txt"));',
      "fs.realpath.native(file, (error, result) => {",
      '  console.log(error === null, result.endsWith("file.txt"));',
      `  ${cleanup}`,
      "});",
    ],
  ],
  [
    "fs-cp-sync-copies-a-folder",
    ["%NodeJSFS%.prototype.cpSync"],
    [
      ...scaffold,
      'fs.mkdirSync(join(folder, "from"));',
      'fs.writeFileSync(join(folder, "from", "inner.txt"), "inner");',
      'console.log(fs.cpSync(join(folder, "from"), join(folder, "to"), { recursive: true }) === undefined, fs.readdirSync(join(folder, "to")).join());',
      cleanup,
    ],
  ],
  [
    "a-file-handle-reads-writes-and-closes",
    [
      "%NodeJSFS%.prototype.open",
      "%NodeJSFS%.prototype.read",
      "%NodeJSFS%.prototype.write",
      "%NodeJSFS%.prototype.close",
      "%NodeJSFS%.prototype.fstat",
    ],
    [
      ...scaffold,
      'const handle = await fs.promises.open(file, "r+");',
      "const read = await handle.read(Buffer.alloc(8), 0, 5, 0);",
      "console.log(typeof handle.fd, read.bytesRead + 1, read.buffer[0] + 1);",
      'const written = await handle.write("HE", 0);',
      "console.log(written.bytesWritten + 1, typeof written.buffer, (await handle.stat()).size + 1);",
      "console.log((await handle.close()) === undefined);",
      cleanup,
    ],
  ],
  [
    "a-file-handle-truncates-syncs-and-changes-times",
    [
      "%NodeJSFS%.prototype.ftruncate",
      "%NodeJSFS%.prototype.fsync",
      "%NodeJSFS%.prototype.fdatasync",
      "%NodeJSFS%.prototype.futimes",
      "%NodeJSFS%.prototype.fchmod",
      "%NodeJSFS%.prototype.fchown",
    ],
    [
      ...scaffold,
      'const handle = await fs.promises.open(file, "r+");',
      "console.log((await handle.truncate(2)) === undefined, (await handle.sync()) === undefined, (await handle.datasync()) === undefined);",
      "console.log((await handle.utimes(1, 2)) === undefined, (await handle.chmod(0o600)) === undefined, (await handle.chown(process.getuid?.() ?? 0, process.getgid?.() ?? 0)) === undefined);",
      "await handle.close();",
      'console.log(fs.readFileSync(file, "utf8"));',
      cleanup,
    ],
  ],
  [
    "a-file-handle-reads-and-writes-lists-of-buffers",
    ["%NodeJSFS%.prototype.readv", "%NodeJSFS%.prototype.writev"],
    [
      ...scaffold,
      'const handle = await fs.promises.open(file, "r+");',
      "const read = await handle.readv([Buffer.alloc(2), Buffer.alloc(2)], 0);",
      "console.log(read.bytesRead + 1, read.buffers[1].toString());",
      'const written = await handle.writev([Buffer.from("H"), Buffer.from("E")], 0);',
      "console.log(written.bytesWritten + 1, written.buffers.length);",
      "await handle.close();",
      cleanup,
    ],
  ],
  [
    "a-read-stream-passes-chunks-to-its-listener",
    ["%NodeJSFS%.prototype.open", "%NodeJSFS%.prototype.read"],
    [
      ...scaffold,
      'fs.createReadStream(file, { encoding: "utf8" })',
      '  .on("data", chunk => console.log(typeof chunk, chunk.length))',
      '  .on("close", () => {',
      '    console.log("closed");',
      `    ${cleanup}`,
      "  });",
    ],
  ],
  [
    "a-write-stream-writes-and-finishes",
    ["%NodeJSFS%.prototype.open", "%NodeJSFS%.prototype.write"],
    [
      ...scaffold,
      "const stream = fs.createWriteStream(file);",
      'stream.write("ab");',
      'stream.end("cd", () => {',
      '  console.log(fs.readFileSync(file, "utf8"));',
      `  ${cleanup}`,
      "});",
    ],
  ],
  [
    "fs-watch-and-watch-file-answer-objects-that-close",
    ["%NodeJSFS%.prototype.watch", "%NodeJSFS%.prototype.watchFile"],
    [
      ...scaffold,
      "const watcher = fs.watch(folder);",
      "console.log(typeof watcher.close, watcher.close() === undefined);",
      "const listener = () => {};",
      "console.log(typeof fs.watchFile(file, listener), fs.unwatchFile(file, listener) === undefined);",
      cleanup,
    ],
  ],
  [
    "fs-stats-and-dirent-are-classes",
    ["%NodeJSFS%.prototype.Stats", "%NodeJSFS%.prototype.Dirent"],
    [
      'import fs from "node:fs";',
      'console.log(typeof fs.Stats, typeof fs.Dirent, fs.statSync(".") instanceof fs.Stats);',
    ],
  ],
  [
    "a-file-sink-writes-and-ends",
    ["%FileSink%.prototype.write", "%FileSink%.prototype.flush", "%FileSink%.prototype.end", "Blob.prototype.writer"],
    [
      ...scaffold,
      "const sink = Bun.file(file).writer();",
      'console.log(typeof sink.write("ab"), typeof sink.write(new Uint8Array([99])), typeof (await sink.flush()), typeof (await sink.end()));',
      'console.log(fs.readFileSync(file, "utf8"));',
      cleanup,
    ],
  ],
  [
    "bun-file-reads-writes-and-deletes",
    [
      "Bun.file",
      "Bun.write",
      "Blob.prototype.text",
      "Blob.prototype.exists",
      "Blob.prototype.delete",
      "Blob.prototype.write",
      "Blob.prototype.stat",
      "Blob.prototype.unlink",
    ],
    [
      ...scaffold,
      "const blob = Bun.file(file);",
      "console.log((await blob.text()).length, blob.size + 1, await blob.exists(), (await blob.stat()).size + 1, typeof blob.lastModified);",
      'console.log((await Bun.write(file, "longer text")) + 1, (await blob.write("ab")) + 1, (await blob.text()).length);',
      "console.log((await blob.delete()) === undefined, await blob.exists());",
      cleanup,
    ],
  ],
  [
    "an-array-buffer-sink-collects-what-is-written",
    [
      "Bun.ArrayBufferSink",
      "Bun.ArrayBufferSink.prototype.start",
      "Bun.ArrayBufferSink.prototype.write",
      "Bun.ArrayBufferSink.prototype.flush",
      "Bun.ArrayBufferSink.prototype.end",
    ],
    [
      "const sink = new Bun.ArrayBufferSink();",
      "console.log(sink.start({ asUint8Array: true }) === undefined);",
      'console.log(sink.write("ab") + 1, sink.write(new Uint8Array([99])) + 1);',
      "const bytes = sink.end();",
      "console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[2] + 1);",
    ],
  ],
  [
    "the-members-of-a-subprocess-are-read",
    [
      "%Subprocess%.prototype.pid",
      "%Subprocess%.prototype.exited",
      "%Subprocess%.prototype.exitCode",
      "%Subprocess%.prototype.signalCode",
      "%Subprocess%.prototype.killed",
      "%Subprocess%.prototype.ref",
      "%Subprocess%.prototype.unref",
      "%Subprocess%.prototype.resourceUsage",
      "%Subprocess%.prototype.stdio",
      "%Subprocess%.prototype.connected",
    ],
    [
      'const child = Bun.spawn(["echo", "hello"]);',
      "console.log(typeof child.pid, child.exitCode === null || child.exitCode === 0, child.ref() === undefined, child.unref() === undefined, child.connected);",
      "console.log((await child.exited) + 1, child.exitCode + 1, child.signalCode === null, child.killed, Array.isArray(child.stdio));",
      "const usage = child.resourceUsage();",
      "console.log(typeof usage.maxRSS, typeof usage.cpuTime.user, typeof usage.contextSwitches.voluntary, typeof usage.ops.in, typeof usage.messages.sent, typeof usage.shmSize, typeof usage.signalCount, typeof usage.swapCount);",
    ],
  ],
  [
    "kill-of-a-subprocess-ends-it-with-a-signal",
    ["%Subprocess%.prototype.kill", "%Subprocess%.prototype.signalCode"],
    [
      'const child = Bun.spawn(["sleep", "10"]);',
      "console.log(child.kill() === undefined);",
      "await child.exited;",
      "console.log(child.signalCode, child.killed, child.exitCode === null);",
    ],
  ],
  [
    "a-resolve-message-has-its-members",
    [
      "ResolveMessage.prototype.message",
      "ResolveMessage.prototype.code",
      "ResolveMessage.prototype.specifier",
      "ResolveMessage.prototype.referrer",
      "ResolveMessage.prototype.importKind",
      "ResolveMessage.prototype.level",
      "ResolveMessage.prototype.position",
      "ResolveMessage.prototype.toString",
      "ResolveMessage.prototype.toJSON",
    ],
    [
      "try {",
      '  Bun.resolveSync("./no-such-module-here", import.meta.dir);',
      "} catch (error) {",
      "  console.log(error.name, typeof error.message, error.code, error.specifier, typeof error.referrer, error.importKind, error.level, typeof error.position, typeof error.toString(), typeof error.toJSON());",
      "}",
    ],
  ],
];

const paths: [string, string, string[]][] = [
  ["join", '"a", "..", "b", "c.txt"', ["console.log(typeof result, result.length, result);"]],
  ["resolve", '"/a", "b", "../c"', ["console.log(typeof result, result.length, result);"]],
  ["normalize", '"/a/./b/../c/"', ["console.log(typeof result, result.length, result);"]],
  ["basename", '"/a/b/c.txt", ".txt"', ["console.log(typeof result, result.length, result);"]],
  ["dirname", '"/a/b/c.txt"', ["console.log(typeof result, result.length, result);"]],
  ["extname", '"/a/b/c.txt"', ["console.log(typeof result, result.length, result);"]],
  ["relative", '"/a/b/c", "/a/d"', ["console.log(typeof result, result.length, result);"]],
  ["isAbsolute", '"/a"', ["console.log(typeof result, result);"]],
  ["toNamespacedPath", '"/a/b"', ["console.log(typeof result, result.length, result);"]],
  [
    "parse",
    '"/a/b/c.txt"',
    [
      "console.log(Object.keys(result).join(), result.root.length, result.dir, result.base, result.ext.length, result.name);",
    ],
  ],
  ["format", '{ dir: "/a/b", name: "c", ext: ".txt" }', ["console.log(typeof result, result.length, result);"]],
];

function pathPrograms(): Program[] {
  const programs: Program[] = [];
  for (const [name, passed, uses] of paths) {
    for (const [flavor, suffix] of [
      ["posix", "Posix"],
      ["win32", "Win32"],
    ]) {
      programs.push({
        name: `path-${flavor}-${kebab(name)}-and-what-it-answers`,
        rows: [`native:Bindgen:node_path.bind.ts:${name}${suffix}`],
        text: lines('import path from "node:path";', `const result = path.${flavor}.${name}(${passed});`, uses),
      });
    }
    if (name !== "format" && name !== "toNamespacedPath") {
      programs.push({
        name: `path-${kebab(name)}-of-a-number-throws`,
        rows: [`native:Bindgen:node_path.bind.ts:${name}Posix`],
        text: lines(
          'import path from "node:path";',
          "try {",
          `  path.${name}(1.5);`,
          "} catch (error) {",
          "  console.log(error instanceof TypeError, error.code);",
          "}",
        ),
      });
    }
  }
  programs.push({
    name: "path-format-reads-the-members-of-its-argument-through-getters",
    rows: ["native:Bindgen:node_path.bind.ts:formatPosix"],
    text: lines(
      'import path from "node:path";',
      "const probe = {",
      "  count: 0,",
      "  get dir() {",
      "    this.count++;",
      '    return "/a";',
      "  },",
      "  get base() {",
      "    this.count++;",
      '    return "b.txt";',
      "  },",
      "};",
      "console.log(path.format(probe), probe.count);",
    ),
  });
  return programs;
}

const rewriter = (handlers: string[], html: string) => [
  "const rewriter = new HTMLRewriter();",
  ...handlers,
  `console.log(await rewriter.transform(new Response(${JSON.stringify(html)})).text());`,
];

const modules: [string, string[], string[]][] = [
  [
    "an-html-rewriter-runs-the-element-handler",
    [
      "HTMLRewriter",
      "%Element%.prototype.tagName",
      "%Element%.prototype.getAttribute",
      "%Element%.prototype.hasAttribute",
      "%Element%.prototype.attributes",
    ],
    rewriter(
      [
        'rewriter.on("p", {',
        "  element(element) {",
        '    console.log(element.tagName, element.getAttribute("class").length, element.getAttribute("missing") === null, element.hasAttribute("class"), [...element.attributes][0].join(), arguments.length);',
        "  },",
        "});",
      ],
      '<p class="big">text</p>',
    ),
  ],
  [
    "an-element-handler-changes-the-element",
    [
      "%Element%.prototype.setAttribute",
      "%Element%.prototype.removeAttribute",
      "%Element%.prototype.before",
      "%Element%.prototype.after",
      "%Element%.prototype.prepend",
      "%Element%.prototype.append",
    ],
    rewriter(
      [
        'rewriter.on("p", {',
        "  element(element) {",
        '    console.log(element.setAttribute("id", "one") === element, element.removeAttribute("class") === element);',
        '    element.before("<b>").after("<i>", { html: true }).prepend("[").append("]");',
        "  },",
        "});",
      ],
      '<p class="big">text</p>',
    ),
  ],
  [
    "an-element-handler-replaces-and-removes-elements",
    [
      "%Element%.prototype.replace",
      "%Element%.prototype.remove",
      "%Element%.prototype.removed",
      "%Element%.prototype.removeAndKeepContent",
      "%Element%.prototype.setInnerContent",
    ],
    rewriter(
      [
        'rewriter.on("a", {',
        "  element(element) {",
        '    element.replace("replaced");',
        "  },",
        "});",
        'rewriter.on("b", {',
        "  element(element) {",
        "    console.log(element.removed);",
        "    element.remove();",
        "    console.log(element.removed);",
        "  },",
        "});",
        'rewriter.on("i", {',
        "  element(element) {",
        "    element.removeAndKeepContent();",
        "  },",
        "});",
        'rewriter.on("u", {',
        "  element(element) {",
        '    element.setInnerContent("inner");',
        "  },",
        "});",
      ],
      "<a>1</a><b>2</b><i>3</i><u>4</u>",
    ),
  ],
  [
    "an-element-handler-reads-the-other-members",
    ["%Element%.prototype.namespaceURI", "%Element%.prototype.selfClosing", "%Element%.prototype.canHaveContent"],
    rewriter(
      [
        'rewriter.on("br", {',
        "  element(element) {",
        "    console.log(typeof element.namespaceURI, element.selfClosing, element.canHaveContent);",
        "  },",
        "});",
      ],
      "<br/>",
    ),
  ],
  [
    "on-end-tag-runs-its-callback-with-the-end-tag",
    [
      "%Element%.prototype.onEndTag",
      "%EndTag%.prototype.name",
      "%EndTag%.prototype.before",
      "%EndTag%.prototype.after",
      "%EndTag%.prototype.remove",
    ],
    rewriter(
      [
        'rewriter.on("p", {',
        "  element(element) {",
        "    element.onEndTag(function (tag) {",
        "      console.log(tag.name, arguments.length);",
        '      tag.before("[").after("]");',
        "    });",
        "  },",
        "});",
      ],
      "<p>text</p>",
    ),
  ],
  [
    "an-html-rewriter-runs-the-text-handler",
    [
      "%TextChunk%.prototype.text",
      "%TextChunk%.prototype.lastInTextNode",
      "%TextChunk%.prototype.removed",
      "%TextChunk%.prototype.replace",
      "%TextChunk%.prototype.before",
      "%TextChunk%.prototype.after",
    ],
    rewriter(
      [
        'rewriter.on("p", {',
        "  text(chunk) {",
        "    console.log(typeof chunk.text, chunk.text.length, chunk.lastInTextNode, chunk.removed);",
        '    if (chunk.text.length > 0) chunk.before("<").after(">").replace(chunk.text.toUpperCase());',
        "  },",
        "});",
      ],
      "<p>text</p>",
    ),
  ],
  [
    "an-html-rewriter-runs-the-comments-handler",
    [
      "%Comment%.prototype.text",
      "%Comment%.prototype.removed",
      "%Comment%.prototype.replace",
      "%Comment%.prototype.before",
      "%Comment%.prototype.after",
      "%Comment%.prototype.remove",
    ],
    rewriter(
      [
        'rewriter.on("p", {',
        "  comments(comment) {",
        "    console.log(comment.text.length, comment.removed);",
        '    comment.text = "changed";',
        '    comment.before("[").after("]");',
        "  },",
        "});",
      ],
      "<p><!-- note --></p>",
    ),
  ],
  [
    "an-html-rewriter-runs-the-document-handlers",
    ["%DocType%.prototype.name", "%DocType%.prototype.publicId", "%DocType%.prototype.systemId"],
    rewriter(
      [
        "rewriter.onDocument({",
        "  doctype(doctype) {",
        "    console.log(doctype.name, doctype.publicId === null, doctype.systemId === null);",
        "  },",
        "  end(end) {",
        '    end.append("<!-- end -->", { html: true });',
        "  },",
        "});",
      ],
      "<!DOCTYPE html><p>text</p>",
    ),
  ],
  [
    "a-handler-of-an-html-rewriter-stores-into-an-object-of-the-program",
    ["HTMLRewriter"],
    [
      "const seen = { name: 0 };",
      ...rewriter(
        ['rewriter.on("p", {', "  element(element) {", "    seen.name = element.tagName;", "  },", "});"],
        "<p>text</p>",
      ),
      "console.log(typeof seen.name, seen.name.length);",
    ],
  ],
  [
    "os-functions-answer-their-kinds",
    [
      "native:Bindgen:node_os.bind.ts:cpus",
      "native:Bindgen:node_os.bind.ts:freemem",
      "native:Bindgen:node_os.bind.ts:totalmem",
      "native:Bindgen:node_os.bind.ts:homedir",
      "native:Bindgen:node_os.bind.ts:hostname",
      "native:Bindgen:node_os.bind.ts:loadavg",
      "native:Bindgen:node_os.bind.ts:release",
      "native:Bindgen:node_os.bind.ts:uptime",
      "native:Bindgen:node_os.bind.ts:version",
      "native:Bindgen:node_os.bind.ts:getPriority",
    ],
    [
      'import os from "node:os";',
      "const cpus = os.cpus();",
      "console.log(Array.isArray(cpus), typeof cpus[0].model, typeof cpus[0].speed, typeof cpus[0].times.user, typeof os.freemem(), typeof os.totalmem(), typeof os.homedir(), typeof os.hostname());",
      "console.log(os.loadavg().length, typeof os.loadavg()[0], typeof os.release(), typeof os.uptime(), typeof os.version(), typeof os.getPriority(), typeof os.availableParallelism());",
    ],
  ],
  [
    "os-user-info-and-network-interfaces-answer-objects",
    ["native:Bindgen:node_os.bind.ts:userInfo", "native:Bindgen:node_os.bind.ts:networkInterfaces"],
    [
      'import os from "node:os";',
      "const user = os.userInfo();",
      "console.log(typeof user.username, typeof user.uid, typeof user.homedir, typeof user.shell);",
      "const interfaces = Object.values(os.networkInterfaces());",
      "console.log(Array.isArray(interfaces[0]), typeof interfaces[0][0].address, typeof interfaces[0][0].internal, typeof interfaces[0][0].family);",
    ],
  ],
  [
    "zlib-sync-functions-round-trip",
    [
      "%NativeZlib%.prototype.writeSync",
      "%NativeZlib%.prototype.init",
      "%NativeBrotli%.prototype.writeSync",
      "%NativeZstd%.prototype.writeSync",
    ],
    [
      'import zlib from "node:zlib";',
      'console.log(zlib.gunzipSync(zlib.gzipSync("hello")).toString(), zlib.inflateSync(zlib.deflateSync("hello")).length + 1, zlib.brotliDecompressSync(zlib.brotliCompressSync("hello")).toString(), zlib.zstdDecompressSync(zlib.zstdCompressSync("hello")).toString());',
    ],
  ],
  [
    "zlib-gzip-passes-the-bytes-to-its-callback",
    ["%NativeZlib%.prototype.write", "%NativeZlib%.prototype.close"],
    [
      'import zlib from "node:zlib";',
      'zlib.gzip("hello", function (error, bytes) {',
      "  console.log(error === null, bytes instanceof Buffer, arguments.length);",
      "  zlib.gunzip(bytes, (failure, text) => console.log(failure === null, text.toString()));",
      "});",
    ],
  ],
  [
    "a-gzip-stream-passes-chunks-to-its-listener",
    ["%NativeZlib%.prototype.write", "%NativeZlib%.prototype.reset", "%NativeZlib%.prototype.params"],
    [
      'import zlib from "node:zlib";',
      "const chunks = [];",
      "const stream = zlib.createGzip();",
      'stream.on("data", chunk => chunks.push(chunk));',
      'stream.on("end", () => console.log(zlib.gunzipSync(Buffer.concat(chunks)).toString()));',
      'stream.end("hello");',
    ],
  ],
  [
    "zlib-of-bad-bytes-throws",
    ["%NativeZlib%.prototype.writeSync"],
    [
      'import zlib from "node:zlib";',
      "try {",
      '  zlib.gunzipSync("not gzip");',
      "} catch (error) {",
      "  console.log(error instanceof Error, error.code, typeof error.errno);",
      "}",
    ],
  ],
  [
    "util-types-tell-kinds-apart",
    [
      "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsError",
      "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsMapIterator",
      "native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsSetIterator",
    ],
    [
      'import { types } from "node:util";',
      "console.log(types.isNativeError(new RangeError()), types.isNativeError({}), types.isMapIterator(new Map().keys()), types.isSetIterator(new Set().values()), types.isMapIterator([].values()), types.isPromise(Promise.resolve()), types.isDate(new Date(0)), types.isRegExp(/a/), types.isTypedArray(new Uint8Array()), types.isProxy(new Proxy({}, {})));",
    ],
  ],
  [
    "util-is-deep-strict-equal-compares-contents",
    ["native:NewCppFunction:NodeUtilTypesModule.cpp:jsFunctionIsDeepStrictEqual"],
    [
      'import { isDeepStrictEqual } from "node:util";',
      'console.log(isDeepStrictEqual({ a: [1.5] }, { a: [1.5] }), isDeepStrictEqual({ a: 1 }, { a: "1" }), isDeepStrictEqual(new Map([[1, 2]]), new Map([[1, 2]])));',
    ],
  ],
  [
    "util-parse-env-answers-an-object-of-text",
    ["native:Bindgen:node_util_binding.bind.ts:parseEnv"],
    [
      'import { parseEnv } from "node:util";',
      'const parsed = parseEnv("FIRST=1\\nSECOND=two");',
      "console.log(typeof parsed.FIRST, parsed.FIRST.length, parsed.SECOND, parsed.MISSING === undefined, Object.keys(parsed).join());",
    ],
  ],
  [
    "util-get-system-error-name-answers-text",
    [
      "native:Bindgen:node_util_binding.bind.ts:internalErrorName",
      "native:Bindgen:node_util_binding.bind.ts:internalErrorEntries",
    ],
    [
      'import { getSystemErrorMap, getSystemErrorName } from "node:util";',
      'const [number] = [...getSystemErrorMap()].find(([, [name]]) => name === "ENOENT");',
      "console.log(getSystemErrorName(number), getSystemErrorMap() instanceof Map, getSystemErrorMap().get(number)[0]);",
    ],
  ],
  [
    "validators-of-node-modules-throw-errors-with-codes",
    [
      "native:Bindgen:node_validators:validateInteger",
      "native:Bindgen:node_validators:validateNumber",
      "native:Bindgen:node_validators:validateObject",
      "native:Bindgen:node_validators:validateAbortSignal",
      "native:Bindgen:node_validators:validateOneOf",
      "native:Bindgen:node_validators:validateUint32",
      "native:Bindgen:node_validators:validateInt32",
      "native:Bindgen:node_validators:validateArray",
      "native:Bindgen:node_validators:validateBuffer",
      "native:Bindgen:node_validators:validatePort",
    ],
    [
      'import { EventEmitter, once } from "node:events";',
      'import { createServer } from "node:net";',
      'import { randomBytes, randomInt } from "node:crypto";',
      "const attempts = [",
      '  () => new EventEmitter().setMaxListeners("many"),',
      '  () => once(new EventEmitter(), "ready", { signal: 1.5 }),',
      "  () => createServer().listen({ port: 70000 }),",
      '  () => randomBytes("many"),',
      "  () => randomInt(1.5),",
      '  () => Buffer.alloc(4).readInt8("first"),',
      "  () => Buffer.concat(1.5),",
      "];",
      "for (const attempt of attempts) {",
      "  try {",
      "    await attempt();",
      '    console.log("no error");',
      "  } catch (error) {",
      "    console.log(error.name, error.code);",
      "  }",
      "}",
    ],
  ],
  [
    "net-is-ip-socket-address-and-block-list",
    [
      "%SocketAddress%",
      "%SocketAddress%.prototype.address",
      "%SocketAddress%.prototype.port",
      "%SocketAddress%.prototype.family",
      "%SocketAddress%.prototype.flowlabel",
      "%BlockList%",
      "%BlockList%.prototype.addAddress",
      "%BlockList%.prototype.check",
      "%BlockList%.prototype.addRange",
      "%BlockList%.prototype.addSubnet",
      "%BlockList%.prototype.rules",
    ],
    [
      'import { BlockList, isIP, isIPv4, SocketAddress } from "node:net";',
      'const address = new SocketAddress({ address: "127.0.0.1", port: 80 });',
      'console.log(isIP("127.0.0.1") + 1, isIP("x"), isIPv4("::1"), address.address, address.port + 1, address.family, address.flowlabel + 1);',
      "const list = new BlockList();",
      'list.addAddress("10.0.0.1");',
      'list.addRange("10.0.1.1", "10.0.1.9");',
      'list.addSubnet("10.1.0.0", 16);',
      'console.log(list.check("10.0.0.1"), list.check("10.0.1.5"), list.check("10.1.2.3"), list.check("8.8.8.8"), list.rules.length);',
    ],
  ],
  [
    "a-net-server-and-client-run-their-listeners",
    ["%TCPSocket%.prototype.write", "%TCPSocket%.prototype.end", "%Listener%.prototype.stop"],
    [
      'import { connect, createServer } from "node:net";',
      "const server = createServer(function (socket) {",
      "  console.log(this === server, typeof socket.remotePort, arguments.length);",
      '  socket.on("data", chunk => {',
      "    console.log(chunk instanceof Buffer, chunk.toString());",
      '    socket.end("pong");',
      "  });",
      "});",
      "server.listen(0, () => {",
      '  const client = connect(server.address().port, () => client.write("ping"));',
      '  client.on("data", chunk => console.log(chunk.toString()));',
      '  client.on("close", hadError => {',
      "    console.log(hadError);",
      "    server.close();",
      "  });",
      "});",
    ],
  ],
  [
    "a-child-process-passes-its-output-to-the-callback",
    ["%Subprocess%.prototype.exited"],
    [
      'import { execFile, execFileSync, spawnSync } from "node:child_process";',
      'console.log(execFileSync("echo", ["hello"]).toString().length, spawnSync("echo", ["hello"]).status + 1);',
      'execFile("echo", ["hello"], function (error, stdout, stderr) {',
      "  console.log(error === null, typeof stdout, stdout.length, stderr.length, arguments.length);",
      "});",
    ],
  ],
  [
    "crypto-hashes-and-random-bytes-answer-their-kinds",
    ["node:crypto.createHash"],
    [
      'import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";',
      'console.log(createHash("sha256").update("a").digest("hex").length, createHash("md5").update("a").digest().length + 1, createHmac("sha1", "key").update("a").digest("base64").length, randomBytes(4).length + 1, randomUUID().length, timingSafeEqual(Buffer.from("a"), Buffer.from("a")));',
    ],
  ],
  [
    "a-worker-thread-message-port-carries-a-copy",
    ["node:worker_threads.MessageChannel"],
    [
      'import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";',
      "const { port1, port2 } = new MessageChannel();",
      'port1.postMessage({ size: 1.5, list: ["two"] });',
      "const received = receiveMessageOnPort(port2);",
      "console.log(received.message.size + 1, received.message.list[0].length, receiveMessageOnPort(port2) === undefined);",
      "port1.close();",
    ],
  ],
  [
    "string-decoder-joins-split-characters",
    ["node:string_decoder.StringDecoder"],
    [
      'import { StringDecoder } from "node:string_decoder";',
      'const decoder = new StringDecoder("utf8");',
      "console.log(decoder.write(Buffer.from([0xe2, 0x82])).length, decoder.write(Buffer.from([0xac])), decoder.end().length);",
    ],
  ],
  [
    "querystring-and-url-parse-answer-objects",
    ["node:querystring.parse"],
    [
      'import querystring from "node:querystring";',
      'import url from "node:url";',
      'const parsed = querystring.parse("first=1&second=two&first=3");',
      'console.log(parsed.first.length, parsed.second.length, parsed.missing === undefined, querystring.stringify({ a: [1, 2], b: "c" }), url.parse("https://example.com/a?b=c").query, url.fileURLToPath("file:///C:/a/b"));',
    ],
  ],
  [
    "assert-throws-an-assertion-error-with-its-members",
    ["node:assert.strictEqual"],
    [
      'import assert from "node:assert";',
      "try {",
      '  assert.strictEqual(1.5, "1.5");',
      "} catch (error) {",
      "  console.log(error instanceof assert.AssertionError, error.code, error.actual + 1, error.expected.length, error.operator);",
      "}",
      "assert.deepStrictEqual({ a: [1.5] }, { a: [1.5] });",
      "assert.throws(() => {",
      "  throw new RangeError();",
      "}, RangeError);",
      'console.log("passed");',
    ],
  ],
  [
    "readline-passes-lines-to-its-listener",
    ["node:readline.createInterface"],
    [
      'import { createInterface } from "node:readline";',
      'import { Readable } from "node:stream";',
      'const reader = createInterface({ input: Readable.from(["first\\nsecond\\n"]) });',
      'reader.on("line", line => console.log(typeof line, line.length, line));',
      'reader.on("close", () => console.log("closed"));',
    ],
  ],
  [
    "stream-pipeline-runs-a-transform-and-its-callback",
    ["node:stream.pipeline"],
    [
      'import { pipeline, Readable, Transform, Writable } from "node:stream";',
      "const seen = [];",
      "pipeline(",
      '  Readable.from(["a", "b"]),',
      "  new Transform({",
      "    transform(chunk, encoding, done) {",
      "      done(null, chunk.toString().toUpperCase());",
      "    },",
      "  }),",
      "  new Writable({",
      "    write(chunk, encoding, done) {",
      "      seen.push(chunk.toString());",
      "      done();",
      "    },",
      "  }),",
      "  error => console.log(error === undefined, seen.join()),",
      ");",
    ],
  ],
];

export function nodePrograms(): Program[] {
  return [
    ...fileSystemPrograms(),
    ...pathPrograms(),
    ...[...others, ...modules].map(([name, rows, text]) => ({ name, rows, text: lines(text) })),
  ];
}
