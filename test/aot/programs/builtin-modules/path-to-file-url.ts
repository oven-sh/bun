// url.pathToFileURL(): what it encodes, its `windows` option, UNC paths, trailing separators, and what it refuses.
import url, { pathToFileURL } from "node:url";

const paths = ["/a/b", "/a/b/", "/", "/with space/and#hash?query%percent", "/tab\there\nnewline\rreturn", '/quote"back\\slash', "/[brackets]^caret|pipe~tilde", "/\u00e9\u{1F600}", "relative/../x", ""];
for (const path of paths) console.log(JSON.stringify(path), pathToFileURL(path).href.replace(pathToFileURL(process.cwd()).href, "<cwd>"));
for (const path of ["C:\\a\\b", "C:\\a\\b\\", "C:/mixed\\slashes/", "\\\\server\\share\\file", "\\\\?\\UNC\\server\\share\\file", "\\\\server", "\\\\\\share", "\\\\bad host\\share\\x"]) {
  try {
    console.log(JSON.stringify(path), pathToFileURL(path, { windows: true }).href);
  } catch (error) {
    console.log(JSON.stringify(path), (error as any).code, (error as Error).message);
  }
}
console.log(pathToFileURL("/posix\\kept", { windows: false }).href, pathToFileURL("/x", null as any).href, pathToFileURL("/x") instanceof URL);
for (const value of [undefined, null, 1, {}, new URL("file:///x")]) {
  try {
    pathToFileURL(value as any);
  } catch (error) {
    console.log((error as any).code, (error as Error).message);
  }
}
console.log(url.pathToFileURL === pathToFileURL, pathToFileURL.name, pathToFileURL.length);
