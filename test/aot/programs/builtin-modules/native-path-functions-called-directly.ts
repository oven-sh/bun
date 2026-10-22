// Where the operands are strings, compiled code calls the native code behind a function of node:path by itself: no function object, no frame of a host function, no wrapper.
// STATISTIC: NativeFunctionsCalledDirectly >= 20
// STATISTIC: NativeFunctionTestsEmitted = 0
import path from "node:path";
function report(name: string, probe: () => unknown) {
  let answer: unknown;
  try {
    answer = probe();
  } catch (error) {
    answer = [(error as any).name, (error as any).code, (error as Error).message];
  }
  console.log(name, JSON.stringify(answer));
}
const rope = "/a/" + String(process.argv.length) + "/" + "b".repeat(3) + ".txt";
report("isAbsolute", () => [path.isAbsolute("/a"), path.isAbsolute("a"), path.isAbsolute(""), path.isAbsolute(rope)]);
report("join", () => [path.join("a", "b"), path.join("/a/", "../b", "c"), path.join(), path.join(""), path.join(rope, "..")]);
report("resolve", () => [path.resolve("/a", "b"), path.resolve("/a", "/b"), path.resolve("/a/b", "..")]);
report("normalize", () => [path.normalize("/a//b/../c/"), path.normalize(""), path.normalize("./x")]);
report("dirname", () => [path.dirname("/a/b/c.txt"), path.dirname("c"), path.dirname("/"), path.dirname(rope)]);
report("basename", () => [path.basename("/a/b/c.txt"), path.basename("/a/b/c.txt", ".txt"), path.basename(""), path.basename(rope)]);
report("extname", () => [path.extname("/a/b/c.txt"), path.extname("c"), path.extname(".profile"), path.extname(rope)]);
report("relative", () => [path.relative("/a/b", "/a/c/d"), path.relative("/a", "/a")]);
report("parse", () => [path.parse("/a/b/c.txt"), path.parse(""), Object.keys(path.parse("x"))]);
report("format", () => path.format({ dir: "/a", base: "b.txt" }));
report("toNamespacedPath", () => [path.toNamespacedPath("/a"), (path as any).toNamespacedPath(5)]);
report("not Latin-1", () => [path.join("\u4f60", "\u597d"), path.basename("/\u4f60/\u597d.txt"), path.isAbsolute("\u4f60")]);
report("win32", () => [path.win32.isAbsolute("C:\\a"), path.win32.isAbsolute("/a"), path.win32.join("a", "b"), path.win32.basename("C:\\a\\b.txt")]);
report("posix", () => [path.posix.isAbsolute("C:\\a"), path.posix.join("a", "b"), path.posix.basename("C:\\a\\b.txt")]);
report("the same functions", () => [path.posix.join === (process.platform === "win32" ? path.win32 : path.posix).join, path.posix.posix === path.posix]);
