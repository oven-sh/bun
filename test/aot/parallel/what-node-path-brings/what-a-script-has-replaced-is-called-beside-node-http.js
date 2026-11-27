// The first text of node:path asks native code whether normalize and resolve have been replaced, and under --aot-testing=FirstTexts the objects that hold them are compiled.
// Under that word a Bun with assertions stops at internal/http1_server_fallback unless the program loads node:http.
require("node:http");
const { posix, win32 } = require("node:path");
const ask = () => [posix.join("a", "b"), win32.join("a", "b"), posix.relative("/a", "/b"), win32.relative("C:\\a", "C:\\b"), posix.resolve("c"), win32.resolve("c")].join(" ");
process.cwd = () => "/folder";
console.log(ask());
posix.normalize = win32.normalize = text => `<${text}>`;
posix.resolve = text => `/replaced${text}${text}`;
win32.resolve = text => `D:\\${text.slice(3)}\\${text.slice(3)}`;
console.log(posix.join("a", "b"), win32.join("a", "b"), posix.relative("/a", "/b"), win32.relative("C:\\a", "C:\\b"));
