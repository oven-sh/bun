// A file system call that fails inside `try { } catch { }`: whether or not the handler looks at the error, the program behaves as in plain Bun.
import * as fs from "node:fs";
const missing = "/nowhere/at/all";
function exists(path: string): boolean {
  try {
    fs.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
function existsWithUnusedBinding(path: string): boolean {
  try {
    fs.statSync(path);
    return true;
  } catch (error) {
    return false;
  }
}
function look(path: string): number {
  return fs.lstatSync(path).size + 1;
}
function lookDeeper(depth: number, path: string): number {
  return depth ? lookDeeper(depth - 1, path) + 1 : look(path) + 1;
}
function existsFurtherUp(path: string): boolean {
  try {
    lookDeeper(4, path);
    return true;
  } catch {
    return false;
  }
}
function describe(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  return [e instanceof Error, e.name, e.code, e.errno, e.syscall, e.path, e.message, Object.keys(e).sort().join()].join(" | ");
}
function codeOf(path: string): string {
  try {
    fs.lstatSync(path);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
function codeFurtherUp(path: string): string {
  try {
    lookDeeper(3, path);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
let cleaned = 0;
function withFinally(path: string): number {
  try {
    return look(path) + 1;
  } finally {
    cleaned++;
  }
}
function ignoredBehindFinally(path: string): boolean {
  try {
    withFinally(path);
    return true;
  } catch {
    return false;
  }
}
function innerIgnoresOuterLooks(path: string): string {
  try {
    try {
      fs.readFileSync(path);
    } catch {
      cleaned++;
    }
    fs.readdirSync(path);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
function innerLooksOuterIgnores(path: string): string {
  let seen = "nothing";
  try {
    try {
      fs.accessSync(path);
    } catch (error) {
      seen = describe(error);
      throw error;
    }
  } catch {
    cleaned++;
  }
  return seen;
}
function disposes(path: string): string {
  try {
    using resource = { [Symbol.dispose]() { throw new Error("from dispose"); } };
    fs.lstatSync(path);
    return "none";
  } catch (error) {
    if (!(error instanceof SuppressedError)) return "only " + (error as Error).message;
    const suppressed = error;
    return suppressed.name + " ; " + (suppressed.error as Error).message + " ; " + describe(suppressed.suppressed);
  }
}
function disposesAndIgnores(path: string): boolean {
  try {
    using resource = { [Symbol.dispose]() { cleaned++; } };
    fs.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
async function asyncIgnores(path: string): Promise<boolean> {
  await null;
  try {
    fs.realpathSync(path);
    return true;
  } catch {
    return false;
  }
}
async function asyncRejects(path: string): Promise<number> {
  await null;
  return fs.lstatSync(path).size;
}
function throughCallback(paths: string[]): boolean[] {
  return paths.map(path => {
    try {
      fs.lstatSync(path);
      return true;
    } catch {
      return false;
    }
  });
}
function callbackThrowsToIgnoringCaller(paths: string[]): boolean {
  try {
    paths.forEach(path => fs.lstatSync(path));
    return true;
  } catch {
    return false;
  }
}
async function main(): Promise<void> {
  for (const path of ["/", missing]) {
    console.log([exists(path), existsWithUnusedBinding(path), existsFurtherUp(path), ignoredBehindFinally(path), disposesAndIgnores(path)].join());
    console.log(codeOf(path));
    console.log(codeFurtherUp(path));
    console.log(innerIgnoresOuterLooks(path).replace(/EISDIR.*/, "EISDIR"));
    console.log(innerLooksOuterIgnores(path));
    console.log(disposes(path));
    console.log(await asyncIgnores(path), await asyncRejects(path).then(size => size >= 0, describe));
  }
  console.log(throughCallback(["/", missing, "/"]).join(), callbackThrowsToIgnoringCaller(["/", missing]), callbackThrowsToIgnoringCaller(["/"]));
  let found = 0;
  for (let i = 0; i < 20000; i++) {
    if (exists(i % 3 ? missing : "/")) found++;
    if (existsFurtherUp(i % 5 ? missing : "/")) found++;
  }
  console.log(found, cleaned);
}
main();
