// join() calls normalize(), relative() and toNamespacedPath() call resolve(), and resolve() calls process.cwd(), whatever they are by then.
const path = require("node:path");
const { posix, win32 } = path;
function ask() {
  const from = JSON.parse('["a","b","..","/c","C:d","C:\\\\e"]');
  return [
    posix.resolve(), posix.resolve(from[0]), posix.resolve(from[0], from[1]), posix.resolve(...from.slice(0, 3)), posix.resolve("a", "b", "c", "d"), posix.resolve(...from),
    win32.resolve(), win32.resolve(from[0]), win32.resolve(from[4], from[1]), win32.resolve(...from.slice(0, 3)), win32.resolve("a", "b", "c", "d"), win32.resolve(...from),
    posix.join(), posix.join(from[0]), posix.join(from[0], from[2]), posix.join(...from), win32.join(), win32.join(from[0]), win32.join(...from), win32.join("", ""),
    posix.relative(from[0], from[1]), posix.relative("/x", from[3]), win32.relative(from[0], from[1]), win32.relative("C:\\x", from[5]),
    win32.toNamespacedPath(from[5]), win32.toNamespacedPath("\\\\s\\h\\x"), win32.toNamespacedPath(from[0]),
  ].join(" ");
}
process.cwd = () => "/first/folder";
console.log(ask());
process.cwd = () => "D:\\second";
process.env = { "=C:": "C:\\third" };
console.log(ask());
posix.normalize = win32.normalize = text => `<${text}>`;
console.log(ask());
const { resolve } = win32;
posix.resolve = text => `/replaced/${text}/${text}`;
win32.resolve = text => resolve("E:\\replaced", text);
console.log(posix.relative("a", "b"), posix.relative("/a", "/b"), win32.relative("a", "b\\c"), win32.toNamespacedPath("a"));
for (const call of [() => resolve("a", 5), () => resolve("a", "b", null), () => resolve(undefined, "a", "b", "c")]) {
  try {
    call();
  } catch (error) {
    console.log(error.code, error.message);
  }
}
