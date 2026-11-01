// With noUnusedLocals, a private member whose only use is in code that the build removes is not reported as unused, however it is read.
class Paths {
  private separator = "\\";
  private share = "\\\\";
  private device = "\\\\.\\";
  #root = "C:";
  #brand = true;
  isAbsolute(path: string): boolean {
    if (process.platform === "win32") {
      if (!(#brand in this)) return false;
      const drive = this.#root + this.separator;
      const { share } = this;
      let device = "";
      ({ device } = this);
      return [drive, share, device].some(prefix => path.startsWith(prefix));
    }
    return path.startsWith("/");
  }
}
console.log(new Paths().isAbsolute("/a"));
