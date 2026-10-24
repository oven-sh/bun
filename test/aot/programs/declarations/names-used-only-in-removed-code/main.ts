// With noUnusedLocals and noUnusedParameters, a name whose only use is in code that the build removes is not reported as unused.
const WINDOWS_PATH = /^[a-zA-Z]:/;
type Drive = string;
class Paths {
  private separator = "\\";
  #root = "C:";
  isAbsolute(path: string): boolean {
    if (process.platform === "win32") {
      const drive: Drive = this.#root + this.separator;
      return WINDOWS_PATH.test(path) || path.startsWith(drive);
    }
    return path.startsWith("/");
  }
}
function decode(text: string, onError: (message: string) => void): string {
  if (typeof Buffer === "function") return Buffer.from(text, "base64").toString();
  onError("no Buffer");
  return text;
}
const separator = process.platform === "win32" ? WINDOWS_PATH.source : "/";
console.log(new Paths().isAbsolute("/a"), decode("YQ==", message => console.log(message)), separator);
