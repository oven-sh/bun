// Typed code reads process.platform and process.arch, which are then assigned values outside their types.
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function describe(): string {
  const { platform } = process;
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  if (platform === "linux") return "linux";
  return "another: " + platform;
}
function writtenOut(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";
  return "another: " + process.platform;
}
function separator(host: NodeJS.Process): string {
  return host.platform === "win32" ? ";" : ":";
}
const names: Partial<Record<NodeJS.Platform, string>> = { darwin: "mac", linux: "linux", win32: "windows" };
function lookedUp(): string {
  const { platform } = process;
  return names[platform] ?? "not listed";
}
function wordSize(): number {
  const { arch } = process;
  return arch === "x64" || arch === "arm64" ? 64 : 32;
}
function show(when: string): void {
  const { platform } = process;
  try {
    console.log(when + ": " + [describe(), separator(process), lookedUp(), wordSize(), platform.length, platform.toUpperCase()].join(" | "));
  } catch (error) {
    console.log(when + ": " + (error as Error).name);
  }
}
console.log(writtenOut(), `${process.platform}-${process.arch}`, process.platform.toUpperCase());
show("before");
show("before, again");
(process as any).platform = "made up";
(process as any).arch = "made up";
show("after an assignment");
(process as any).platform = "win32";
show("after assigning win32");
(process as any).platform = 5;
show("after assigning a number");
export {};
