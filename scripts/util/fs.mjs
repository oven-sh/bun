import * as fs from "node:fs";
import * as nodePath from "node:path";
import { tmpdir as nodeTmpdir, homedir as nodeHomedir } from "node:os";
import { printCommand, which } from "./util.mjs";
import { isWindows, isMacOS } from "./env.mjs";
import { spawn } from "./spawn.mjs";

/**
 * Reads the contents of a file as a string.
 * @param {string} path
 * @param {Object} [options]
 * @param {boolean} [options.throwOnError]
 * @returns {string}
 */
export function readFile(path, options) {
  printCommand("cat", [relative(path)]);

  try {
    return fs.readFileSync(path, "utf-8");
  } catch (cause) {
    const { code } = cause;
    if (code === "ENOENT" && options?.throwOnError === false) {
      return;
    }
    throw cause;
  }
}

/**
 * Writes content to a file.
 * @param {string} path
 * @param {string} content
 */
export function writeFile(path, content) {
  printCommand("nano", [relative(path)]);

  function write() {
    fs.writeFileSync(path, content);
  }

  try {
    write();
  } catch (cause) {
    const { code } = cause;
    if (code !== "ENOENT") {
      throw cause;
    }
    mkdir(dirname(path));
    write();
  }
}

/**
 * Removes a file or directory.
 * @param {string} path
 */
export function rm(path) {
  printCommand("rm", ["-rf", relative(path)]);

  fs.rmSync(path, { recursive: true, force: true });
}

/**
 * Copies a file or directory.
 * @param {string} source
 * @param {string} target
 */
export function cp(source, target) {
  printCommand("cp", ["-r", relative(source), relative(target)]);

  function filter(source) {
    return true;
    // return !dirname(source).includes(".git");
  }

  function copy() {
    fs.cpSync(source, target, { recursive: true, force: true, filter });
  }

  try {
    copy();
  } catch (cause) {
    const { code } = cause;
    if (code !== "ENOENT") {
      throw cause;
    }
    mkdir(dirname(target));
    copy();
  }
}

/**
 * Moves a file or directory.
 * @param {string} source
 * @param {string} target
 */
export function mv(source, target) {
  printCommand("mv", [relative(source), relative(target)]);

  function move() {
    fs.renameSync(source, target);
  }

  try {
    move();
  } catch (cause) {
    const { code } = cause;
    if (code === "ENOENT") {
      mkdir(dirname(target));
      move();
    } else if (code === "EPERM") {
      rm(target);
      move();
    } else {
      throw cause;
    }
  }
}

/**
 * Lists the files in a directory.
 * @param {string} path
 * @param {Object} [options]
 * @param {boolean} [options.recursive]
 * @returns {string[]}
 */
export function readdir(path, options = {}) {
  const { recursive } = options;
  if (recursive) {
    printCommand("ls", ["-R", relative(path)]);
  } else {
    printCommand("ls", [relative(path)]);
  }

  return fs
    .readdirSync(path, { withFileTypes: true, recursive })
    .filter(entry => entry.isFile())
    .map(({ name }) => name);
}

/**
 * Creates a symlink to a file.
 * @param {string} source
 * @param {string} target
 */
export function symlink(source, target) {
  printCommand("ln", ["-s", relative(source), relative(target)]);

  try {
    if (fs.realpathSync(target) === source) {
      return;
    }
    fs.unlinkSync(target);
  } catch {
    // Ignore
  }

  const type = isFile(source) ? "file" : "dir";
  fs.symlinkSync(source, target, type);
}

/**
 * Creates a temporary directory.
 * @param {string} label
 * @param {Object} [options]
 * @param {boolean} [options.clean]
 * @returns {string}
 */
export function mkdirTmp(label) {
  const tmp = tmpdir();
  const random = Math.random().toString(36).slice(2);

  const path = join(tmp, `${label}-${random}`);
  mkdir(path, { clean: true });
  return path;
}

/**
 * Gets the temporary directory.
 * @returns {string}
 */
export function tmpdir() {
  if (isWindows) {
    for (const key of ["RUNNER_TEMP", "TMPDIR", "TEMP", "TEMPDIR", "TMP"]) {
      const tmpdir = process.env[key];
      // HACK: There are too many bugs with cygwin directories.
      // We should probably run Windows tests in both cygwin and powershell.
      if (!tmpdir || /cygwin|cygdrive/i.test(tmpdir) || !/^[a-z]/i.test(tmpdir)) {
        continue;
      }
      return nodePath.win32.normalize(tmpdir);
    }
    const appData = process.env["LOCALAPPDATA"];
    if (appData) {
      const appDataTemp = join(appData, "Temp");
      if (exists(appDataTemp)) {
        return appDataTemp;
      }
    }
  }

  if (isMacOS && exists("/tmp")) {
    return "/tmp";
  }

  return nodeTmpdir();
}

/**
 * Gets the home directory.
 * @returns {string}
 */
export function homedir() {
  return nodeHomedir();
}

/**
 * Creates a directory.
 * @param {string} path
 * @param {Object} [options]
 * @param {boolean} [options.clean]
 */
export function mkdir(path, options) {
  printCommand("mkdir", ["-p", relative(path)]);

  if (options?.clean) {
    rm(path);
  }

  fs.mkdirSync(path, { recursive: true });
}

/**
 * Sets the permissions of a file.
 * @param {string} path
 * @param {number} mode
 */
export function chmod(path, mode) {
  printCommand("chmod", [mode.toString(16), relative(path)]);

  fs.chmodSync(path, mode);
}

/**
 * Tests if the given path exists and is a file.
 * @param {string} path
 * @returns {boolean}
 */
export function isFile(path) {
  printCommand("test", ["-f", relative(path)]);

  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Asserts that the given path is a file.
 * @param {string} path
 * @returns {string}
 */
export function assertFile(path) {
  if (!isFile(path)) {
    throw new Error(`Not a file: ${path}`);
  }
  return path;
}

/**
 * Tests if the given path exists and is a directory.
 * @param {string} path
 * @returns {boolean}
 */
export function isDirectory(path) {
  printCommand("test", ["-d", relative(path)]);

  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Asserts that the given path is a directory.
 * @param {string} path
 * @returns {string}
 */
export function assertDirectory(path) {
  if (!isDirectory(path)) {
    throw new Error(`Not a directory: ${path}`);
  }
  return path;
}

/**
 * Tests if the given path exists.
 * @param {string} path
 * @returns {boolean}
 */
export function exists(path) {
  printCommand("test", [relative(path)]);

  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Joins paths.
 * @param {...string | undefined} paths
 * @returns {string}
 */
export function join(...paths) {
  return nodePath.join(...paths.filter(path => typeof path === "string"));
}

/**
 * Resolves paths.
 * @param {...string | undefined} paths
 * @returns {string}
 */
export function resolve(...paths) {
  return nodePath.resolve(...paths.filter(path => typeof path === "string"));
}

/**
 * Gets the relative path from one path to another.
 * @param {string | undefined} from
 * @param {string | undefined} to
 * @returns {string}
 */
export function relative(from, to) {
  if (typeof to === "undefined") {
    to = from;
    from = process.cwd();
  }

  if (typeof from === "undefined") {
    from = process.cwd();
  }

  return nodePath.relative(from, to);
}

/**
 * Gets the parent directory of a path.
 * @param {string} path
 * @returns {string}
 */
export function dirname(path) {
  printCommand("dirname", [relative(path)]);

  return nodePath.dirname(path);
}

/**
 * Gets the file name of a path.
 * @param {string} path
 * @returns {string}
 */
export function basename(path) {
  printCommand("basename", [relative(path)]);

  return nodePath.basename(path);
}

/**
 * Zips a directory into a zip file.
 * @param {string} path
 * @param {string} zipPath
 */
export async function zip(path, zipPath) {
  const cwd = dirname(path);
  const src = basename(path);

  if (isWindows) {
    await spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Compress-Archive -Path "${src}" -DestinationPath "${zipPath}" -Force`,
      ],
      { cwd },
    );
  } else {
    await spawn("zip", ["-r", zipPath, src], { cwd });
  }

  assertFile(zipPath);
}

/**
 * Downloads a file from a URL and saves it to a path.
 * @param {string} url
 * @param {string} outPath
 */
export async function downloadFile(url, outPath) {
  mkdir(dirname(outPath));

  if (which("curl")) {
    const tmpPath = `${outPath}.tmp`;
    await spawn("curl", ["-C", "-", "-f", "-o", tmpPath, "-L", url], { retries: 5 });
    mv(tmpPath, outPath);
  } else if (isWindows) {
    await spawn("powershell", ["-NoProfile", "-Command", `Invoke-WebRequest ${url} -OutFile ${outPath}`]);
  } else {
    throw new Error(`Command not found: curl`);
  }
}

/**
 * Extracts a tar file.
 * @param {string} tarPath
 * @param {string} [outPath]
 */
export async function tar(tarPath, outPath) {
  if (typeof outPath === "undefined") {
    outPath = dirname(tarPath);
  }

  const cwd = dirname(outPath);
  mkdir(cwd);

  const tarOutPath = relative(cwd, outPath).replace(/\\/g, "/");
  await spawn("tar", ["-xzf", tarPath, "-C", tarOutPath], { cwd });

  assertDirectory(outPath);
  rm(tarPath);
}
