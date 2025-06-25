import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { debug } from "./console";

export function join(...paths: (string | string[])[]): string {
  return path.join(...paths.flat(2));
}

export function basename(...paths: (string | string[])[]): string {
  return path.basename(join(...paths));
}

export function tmp(): string {
  const tmpdir = process.env["RUNNER_TEMP"] ?? os.tmpdir();
  const dir = fs.mkdtempSync(join(tmpdir, "bun-"));
  debug("tmp", dir);
  return dir;
}

export function rm(path: string): void {
  debug("rm", path);
  try {
    fs.rmSync(path, { recursive: true });
    return;
  } catch (error) {
    debug("fs.rmSync failed", error);
    // Did not exist before Node.js v14.
    // Attempt again with older, slower implementation.
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(path);
  } catch (error) {
    debug("fs.lstatSync failed", error);
    // The file was likely deleted, so return early.
    return;
  }
  if (!stats.isDirectory()) {
    fs.unlinkSync(path);
    return;
  }
  try {
    fs.rmdirSync(path, { recursive: true });
    return;
  } catch (error) {
    debug("fs.rmdirSync failed", error);
    // Recursive flag did not exist before Node.js X.
    // Attempt again with older, slower implementation.
  }
  for (const filename of fs.readdirSync(path)) {
    rm(join(path, filename));
  }
  fs.rmdirSync(path);
}

export function rename(path: string, newPath: string): void {
  debug("rename", path, newPath);
  try {
    fs.renameSync(path, newPath);
    return;
  } catch (error) {
    debug("fs.renameSync failed", error);
    // If there is an error, delete the new path and try again.
  }
  try {
    rm(newPath);
  } catch (error) {
    debug("rm failed", error);
    // The path could have been deleted already.
  }
  fs.renameSync(path, newPath);
}

export function write(dst: string, content: string | ArrayBuffer | ArrayBufferView): void {
  debug("write", dst);
  try {
    fs.writeFileSync(dst, content);
    return;
  } catch (error) {
    debug("fs.writeFileSync failed", error);
    // If there is an error, ensure the parent directory
    // exists and try again.
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
    } catch (error) {
      debug("fs.mkdirSync failed", error);
      // The directory could have been created already.
    }
    fs.writeFileSync(dst, content);
  }
}

export function writeJson(path: string, json: object, force?: boolean): void {
  let value = json;
  if (!force && exists(path)) {
    try {
      const existing = JSON.parse(read(path));
      value = {
        ...existing,
        ...json,
      };
    } catch {
      value = json;
    }
  }
  write(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

export function read(path: string): string {
  debug("read", path);
  return fs.readFileSync(path, "utf-8");
}

export function blob(path: string): Blob {
  debug("blob", path);
  if ("Bun" in globalThis) {
    return Bun.file(path);
  }
  const buffer = fs.readFileSync(path);
  return new Blob([buffer], {
    type: path.endsWith(".zip") ? "application/zip" : path.endsWith(".txt") ? "text/plain" : "application/octet-stream",
  });
}

export function hash(content: string | crypto.BinaryLike): string {
  debug("hash", content);
  return crypto
    .createHash("sha256")
    .update(typeof content === "string" ? fs.readFileSync(content) : content)
    .digest("hex");
}

export function chmod(path: string, mode: fs.Mode): void {
  debug("chmod", path, mode);
  fs.chmodSync(path, mode);
}

export function copy(path: string, newPath: string): void {
  debug("copy", path, newPath);
  try {
    fs.copyFileSync(path, newPath);
    return;
  } catch (error) {
    debug("fs.copyFileSync failed", error);
  }
  write(newPath, read(path));
}

export function exists(path: string): boolean {
  debug("exists", path);
  try {
    return fs.existsSync(path);
  } catch (error) {
    debug("fs.existsSync failed", error);
  }
  return false;
}

export function link(path: string, newPath: string): void {
  debug("link", path, newPath);
  try {
    fs.unlinkSync(newPath);
    fs.linkSync(path, newPath);
    return;
  } catch (error) {
    copy(path, newPath);
    debug("fs.linkSync failed, reverting to copy", error);
  }
}
