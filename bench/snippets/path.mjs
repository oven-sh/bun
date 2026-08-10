// Every node:path function against a spread of representative inputs, for both
// path.posix and path.win32.
import { posix, win32 } from "node:path";
import { bench, group, run } from "../runner.mjs";

const impls = { posix, win32 };

const cases = {
  resolve: [
    [],
    ["foo/bar"],
    ["/var/www", "static", "../images/logo.png"],
    ["/home/user/project/src/index.ts"],
    ["C:\\Users\\dev\\project", "..\\assets", "img.png"],
  ],
  normalize: [
    ["/foo/bar//baz/asdf/quux/.."],
    ["foo/../../bar"],
    ["/already/normalized/path.js"],
    ["C:\\temp\\\\foo\\bar\\..\\"],
    ["\\\\server\\share\\dir\\..\\file.txt"],
  ],
  isAbsolute: [["/foo/bar"], ["bar/"], ["C:\\foo"], ["\\\\server\\share"]],
  join: [
    ["/foo", "bar", "baz/asdf", "quux", ".."],
    ["src", "index.ts"],
    ["/var/lib/node_modules", "@scope/pkg", "package.json"],
    ["C:\\Program Files", "app", "..\\data\\file.db"],
  ],
  relative: [
    ["/data/orandea/test/aaa", "/data/orandea/impl/bbb"],
    ["/foo/bar/baz", "/foo/bar/baz/qux/quux"],
    ["/", "/foo"],
    ["C:\\orandea\\test\\aaa", "C:\\orandea\\impl\\bbb"],
  ],
  toNamespacedPath: [["/foo/bar"], ["C:\\foo\\bar"], ["\\\\server\\share\\file"]],
  dirname: [
    ["/foo/bar/baz/asdf/quux.html"],
    ["relative/file.txt"],
    ["C:\\foo\\bar\\baz.txt"],
    ["\\\\server\\share\\a\\b"],
  ],
  basename: [
    ["/foo/bar/baz/asdf/quux.html"],
    ["/foo/bar/baz/asdf/quux.html", ".html"],
    ["C:\\foo\\bar\\baz.txt", ".txt"],
  ],
  extname: [["/foo/bar/baz/asdf/quux.html"], ["index."], [".hidden"], ["C:\\foo\\archive.tar.gz"]],
  parse: [["/home/user/dir/file.txt"], ["file"], ["C:\\path\\dir\\index.html"], ["\\\\server\\share\\file"]],
  format: [
    [{ root: "/", dir: "/home/user/dir", base: "file.txt", ext: ".txt", name: "file" }],
    [{ name: "index", ext: "html" }],
    [{ root: "C:\\", dir: "C:\\path\\dir", base: "index.html" }],
  ],
};

// Non-Latin-1 variants to exercise the UTF-16 code path of every function.
const wide = "/home/usér/プロジェクト";
cases.resolve.push([wide, "src/../lib", "索引.js"]);
cases.normalize.push([wide + "/../src/./index.js"]);
cases.join.push(["/home/usér", "プロジェクト", "src/index.js"]);
cases.relative.push([wide + "/İ/a", wide + "/İ/b/索引.js"]);
cases.toNamespacedPath.push(["C:\\usér\\プロジェクト\\索引.js"]);
cases.dirname.push([wide + "/索引.html"]);
cases.basename.push([wide + "/索引.html", ".html"]);
cases.extname.push([wide + "/索引.tar.gz"]);
cases.parse.push([wide + "/索引.html"]);
cases.format.push([{ dir: wide, base: "索引.html" }]);

// Long (2000+ character) variants.
const long = "/modules/@scope/package-name/dist/esm".repeat(50);
cases.resolve.push([long, "../lib/./index.js"]);
cases.normalize.push([long + "/../lib/./index.js"]);
cases.join.push([long, "../lib", "index.js"]);
cases.relative.push([long + "/a/b", long + "/c/d"]);
cases.toNamespacedPath.push(["C:" + long.replaceAll("/", "\\")]);
cases.dirname.push([long + "/index.js"]);
cases.basename.push([long + "/index.js", ".js"]);
cases.extname.push([long + "/index.js"]);
cases.parse.push([long + "/index.js"]);

const fmt = a => {
  const s = typeof a === "string" ? JSON.stringify(a) : JSON.stringify(a).replaceAll('"', "");
  return s.length > 60 ? s.slice(0, 28) + "…" + s.slice(-28) : s;
};

// Fixed-arity call sites so the benchmark measures the path function rather than
// the engine's handling of spread calls.
const callers = [
  f => () => f(),
  (f, a) => () => f(a),
  (f, a, b) => () => f(a, b),
  (f, a, b, c) => () => f(a, b, c),
  (f, a, b, c, d) => () => f(a, b, c, d),
  (f, a, b, c, d, e) => () => f(a, b, c, d, e),
];

for (const [fn, argLists] of Object.entries(cases)) {
  for (const [name, impl] of Object.entries(impls)) {
    group(`${name}.${fn}`, () => {
      for (const args of argLists) {
        bench(`${name}.${fn}(${args.map(fmt).join(", ")})`, callers[args.length](impl[fn], ...args));
      }
    });
  }
}

await run();
