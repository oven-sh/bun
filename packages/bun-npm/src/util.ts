import fs from "fs";
import path, { dirname } from "path";
import { tmpdir } from "os";
import child_process from "child_process";

if (process.env["DEBUG"] !== "1") {
  console.debug = () => {};
}

export function join(...paths: (string | string[])[]): string {
  return path.join(...paths.flat(2));
}

export function tmp(): string {
  const path = fs.mkdtempSync(join(tmpdir(), "bun-"));
  console.debug("tmp", path);
  return path;
}

export function rm(path: string): void {
  console.debug("rm", path);
  try {
    fs.rmSync(path, { recursive: true });
    return;
  } catch (error) {
    console.debug("rmSync failed", error);
    // Did not exist before Node.js v14.
    // Attempt again with older, slower implementation.
  }
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(path);
  } catch (error) {
    console.debug("lstatSync failed", error);
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
    console.debug("rmdirSync failed", error);
    // Recursive flag did not exist before Node.js X.
    // Attempt again with older, slower implementation.
  }
  for (const filename of fs.readdirSync(path)) {
    rm(join(path, filename));
  }
  fs.rmdirSync(path);
}

export function rename(path: string, newPath: string): void {
  console.debug("rename", path, newPath);
  try {
    fs.renameSync(path, newPath);
    return;
  } catch (error) {
    console.debug("renameSync failed", error);
    // If there is an error, delete the new path and try again.
  }
  try {
    rm(newPath);
  } catch (error) {
    console.debug("rm failed", error);
    // The path could have been deleted already.
  }
  fs.renameSync(path, newPath);
}

export function write(
  path: string,
  content: string | ArrayBuffer | ArrayBufferView,
): void {
  console.debug("write", path);
  try {
    fs.writeFileSync(path, content);
    return;
  } catch (error) {
    console.debug("writeFileSync failed", error);
    // If there is an error, ensure the parent directory
    // exists and try again.
    try {
      fs.mkdirSync(dirname(path), { recursive: true });
    } catch (error) {
      console.debug("mkdirSync failed", error);
      // The directory could have been created already.
    }
    fs.writeFileSync(path, content);
  }
}

export function read(path: string): string {
  console.debug("read", path);
  return fs.readFileSync(path, "utf-8");
}

export function chmod(path: string, mode: fs.Mode): void {
  console.debug("chmod", path, mode);
  fs.chmodSync(path, mode);
}

export function spawn(
  cmd: string,
  args: string[],
  options: child_process.SpawnOptions = {},
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  console.debug("spawn", [cmd, ...args].join(" "));
  const { status, stdout, stderr } = child_process.spawnSync(cmd, args, {
    stdio: "pipe",
    encoding: "utf-8",
    ...options,
  });
  return {
    exitCode: status ?? 1,
    stdout,
    stderr,
  };
}

export type Response = {
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T>(): Promise<T>;
};

export const fetch = "fetch" in globalThis ? webFetch : nodeFetch;

async function webFetch(url: string, assert?: boolean): Promise<Response> {
  const response = await globalThis.fetch(url);
  console.debug("fetch", url, response.status);
  if (assert !== false && !isOk(response.status)) {
    throw new Error(`${response.status}: ${url}`);
  }
  return response;
}

async function nodeFetch(url: string, assert?: boolean): Promise<Response> {
  const { get } = await import("node:http");
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      console.debug("get", url, response.statusCode);
      const status = response.statusCode ?? 501;
      if (response.headers.location && isRedirect(status)) {
        return nodeFetch(url).then(resolve, reject);
      }
      if (assert !== false && !isOk(status)) {
        return reject(new Error(`${status}: ${url}`));
      }
      const body: Buffer[] = [];
      response.on("data", (chunk) => {
        body.push(chunk);
      });
      response.on("end", () => {
        resolve({
          status,
          async arrayBuffer() {
            return Buffer.concat(body).buffer as ArrayBuffer;
          },
          async json() {
            const text = Buffer.concat(body).toString("utf-8");
            return JSON.parse(text);
          },
        });
      });
    }).on("error", reject);
  });
}

function isOk(status: number): boolean {
  return status === 200;
}

function isRedirect(status: number): boolean {
  switch (status) {
    case 301: // Moved Permanently
    case 308: // Permanent Redirect
    case 302: // Found
    case 307: // Temporary Redirect
    case 303: // See Other
      return true;
  }
  return false;
}
