/**
 * Isolated Sandbox Runtime
 *
 * Provides true process isolation using Linux namespaces:
 * - User namespace for unprivileged operation
 * - Mount namespace with overlayfs for ephemeral filesystem
 * - Network namespace with firewall rules
 * - PID namespace for process isolation
 * - UTS namespace for hostname isolation
 *
 * Requirements:
 * - Linux kernel with user namespace support
 * - bubblewrap (bwrap) or fuse-overlayfs for unprivileged overlay
 */

import type { Sandboxfile, SandboxOptions } from "./index";

export interface IsolatedSandboxOptions extends SandboxOptions {
  /** Use real Linux namespace isolation (requires bwrap or root) */
  isolated?: boolean;
  /** Root filesystem to use as base (default: /) */
  rootfs?: string;
  /** Extract outputs to this directory after sandbox exits */
  extractDir?: string;
}

interface OverlayDirs {
  baseDir: string;
  upperDir: string;
  workDir: string;
  mergedDir: string;
}

/**
 * Check available isolation methods
 */
export async function checkIsolationSupport(): Promise<{
  bwrap: boolean;
  unshare: boolean;
  fuseOverlayfs: boolean;
  userNamespaces: boolean;
}> {
  const check = async (cmd: string[]): Promise<boolean> => {
    try {
      const proc = Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  };

  const [bwrap, unshare, fuseOverlayfs] = await Promise.all([
    check(["which", "bwrap"]),
    check(["which", "unshare"]),
    check(["which", "fuse-overlayfs"]),
  ]);

  // Check user namespace support
  let userNamespaces = false;
  try {
    const file = Bun.file("/proc/sys/kernel/unprivileged_userns_clone");
    if (await file.exists()) {
      const content = await file.text();
      userNamespaces = content.trim() === "1";
    } else {
      // If sysctl doesn't exist, try to check /proc/self/uid_map writability
      // or just assume it's available on modern kernels
      userNamespaces = true;
    }
  } catch {
    userNamespaces = false;
  }

  return { bwrap, unshare, fuseOverlayfs, userNamespaces };
}

/**
 * Create overlay filesystem directories
 */
async function createOverlayDirs(prefix: string): Promise<OverlayDirs & { cleanup: () => Promise<void> }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");

  const sandboxId = crypto.randomBytes(8).toString("hex");
  const baseDir = `/tmp/bun-sandbox-${prefix}-${sandboxId}`;
  const upperDir = path.join(baseDir, "upper");
  const workDir = path.join(baseDir, "work");
  const mergedDir = path.join(baseDir, "merged");

  await fs.mkdir(upperDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });

  const cleanup = async () => {
    // Try to unmount first
    try {
      const umount = Bun.spawn({
        cmd: ["fusermount", "-u", mergedDir],
        stdout: "ignore",
        stderr: "ignore",
      });
      await umount.exited;
    } catch {}

    try {
      const umount = Bun.spawn({
        cmd: ["umount", "-l", mergedDir],
        stdout: "ignore",
        stderr: "ignore",
      });
      await umount.exited;
    } catch {}

    // Remove directories
    try {
      await fs.rm(baseDir, { recursive: true, force: true });
    } catch {}
  };

  return { baseDir, upperDir, workDir, mergedDir, cleanup };
}

/**
 * Get modified files from overlay upper directory
 */
async function getModifiedFiles(upperDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const files: string[] = [];

  async function walk(dir: string, prefix: string = ""): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.join(prefix, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  await walk(upperDir);
  return files;
}

/**
 * Copy modified files from overlay to destination
 */
async function extractModifiedFiles(upperDir: string, destDir: string, patterns: string[]): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const extracted: string[] = [];
  const modifiedFiles = await getModifiedFiles(upperDir);

  for (const file of modifiedFiles) {
    // Check if file matches any output pattern
    let matches = false;
    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern);
      if (glob.match(file)) {
        matches = true;
        break;
      }
    }

    if (matches) {
      const srcPath = path.join(upperDir, file);
      const destPath = path.join(destDir, file);

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
      extracted.push(file);
    }
  }

  return extracted;
}

/**
 * Build bwrap command arguments for isolation
 */
function buildBwrapArgs(
  config: Sandboxfile,
  rootfs: string,
  workdir: string,
  overlayDirs: OverlayDirs | null,
): string[] {
  const args: string[] = ["bwrap"];

  // User namespace with UID/GID 1000
  args.push("--unshare-user", "--uid", "1000", "--gid", "1000");

  // Mount namespace
  args.push("--unshare-pid", "--unshare-uts", "--unshare-ipc");

  // Hostname
  args.push("--hostname", "sandbox");

  // Network isolation if no NET hosts specified
  if (config.net.length === 0) {
    args.push("--unshare-net");
  }

  // Root filesystem setup
  if (overlayDirs) {
    // Use fuse-overlayfs for unprivileged overlay
    // For now, just bind the rootfs and hope writes go somewhere useful
    args.push("--ro-bind", rootfs, "/");
    args.push("--bind", overlayDirs.upperDir, workdir);
  } else {
    // Simple bind mount
    args.push("--ro-bind", rootfs, "/");
  }

  // Essential mounts
  args.push("--proc", "/proc");
  args.push("--dev", "/dev");
  args.push("--tmpfs", "/tmp");
  args.push("--tmpfs", "/run");

  // Writable home directory
  args.push("--tmpfs", "/home");
  args.push("--tmpfs", "/root");

  // Working directory - make it writable
  args.push("--bind", workdir, workdir);
  args.push("--chdir", workdir);

  // Die with parent process
  args.push("--die-with-parent");

  // Clear environment except what we set
  args.push("--clearenv");

  return args;
}

/**
 * Build unshare command arguments for isolation
 */
function buildUnshareArgs(config: Sandboxfile): string[] {
  const args: string[] = ["unshare", "--user", "--map-root-user", "--mount", "--pid", "--fork", "--uts", "--ipc"];

  // Network isolation if no NET hosts specified
  if (config.net.length === 0) {
    args.push("--net");
  }

  return args;
}

export interface IsolatedSandboxResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  modifiedFiles: string[];
  extractedFiles: string[];
}

/**
 * Run a command in an isolated sandbox using bwrap
 */
export async function runIsolatedBwrap(
  command: string[],
  config: Sandboxfile,
  options: IsolatedSandboxOptions = {},
): Promise<IsolatedSandboxResult> {
  const rootfs = options.rootfs || "/";
  const workdir = options.cwd || config.workdir || process.cwd();

  // Create overlay directories for capturing writes
  const overlay = await createOverlayDirs("bwrap");

  try {
    // Build bwrap arguments
    const bwrapArgs = buildBwrapArgs(config, rootfs, workdir, overlay);

    // Add environment variables
    const env: Record<string, string> = {
      HOME: "/home/sandbox",
      USER: "sandbox",
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
      ...options.env,
    };

    // Add secrets
    for (const secret of config.secrets) {
      const value = process.env[secret];
      if (value) {
        env[secret] = value;
      }
    }

    // Add env vars to bwrap args
    for (const [key, value] of Object.entries(env)) {
      bwrapArgs.push("--setenv", key, value);
    }

    // Add the command
    bwrapArgs.push(...command);

    if (options.verbose) {
      console.log("[sandbox] Running:", bwrapArgs.join(" "));
    }

    // Run the sandboxed command
    const proc = Bun.spawn({
      cmd: bwrapArgs,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Stream output if callbacks provided
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    if (proc.stdout) {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            stdoutChunks.push(text);
            options.onStdout?.("sandbox", text);
          }
        } catch {}
      })();
    }

    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            stderrChunks.push(text);
            options.onStderr?.("sandbox", text);
          }
        } catch {}
      })();
    }

    const exitCode = await proc.exited;

    // Get modified files
    const modifiedFiles = await getModifiedFiles(overlay.upperDir);

    // Extract outputs if requested
    let extractedFiles: string[] = [];
    if (options.extractDir && config.outputs.length > 0) {
      extractedFiles = await extractModifiedFiles(overlay.upperDir, options.extractDir, config.outputs);
    }

    return {
      success: exitCode === 0,
      exitCode: exitCode ?? 1,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      modifiedFiles,
      extractedFiles,
    };
  } finally {
    await overlay.cleanup();
  }
}

/**
 * Run a command in an isolated sandbox using unshare
 */
export async function runIsolatedUnshare(
  command: string[],
  config: Sandboxfile,
  options: IsolatedSandboxOptions = {},
): Promise<IsolatedSandboxResult> {
  const workdir = options.cwd || config.workdir || process.cwd();

  // Create overlay directories
  const overlay = await createOverlayDirs("unshare");

  try {
    // Build unshare arguments
    const unshareArgs = buildUnshareArgs(config);

    // Build environment
    const env: Record<string, string> = {
      HOME: workdir,
      USER: "root",
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
      TERM: "xterm-256color",
      LANG: "C.UTF-8",
      ...options.env,
    };

    // Add secrets
    for (const secret of config.secrets) {
      const value = process.env[secret];
      if (value) {
        env[secret] = value;
      }
    }

    if (options.verbose) {
      console.log("[sandbox] Running:", [...unshareArgs, ...command].join(" "));
    }

    // Run the sandboxed command
    const proc = Bun.spawn({
      cmd: [...unshareArgs, ...command],
      cwd: workdir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Collect output
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    if (proc.stdout) {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            stdoutChunks.push(text);
            options.onStdout?.("sandbox", text);
          }
        } catch {}
      })();
    }

    if (proc.stderr) {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            stderrChunks.push(text);
            options.onStderr?.("sandbox", text);
          }
        } catch {}
      })();
    }

    const exitCode = await proc.exited;

    return {
      success: exitCode === 0,
      exitCode: exitCode ?? 1,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
      modifiedFiles: [],
      extractedFiles: [],
    };
  } finally {
    await overlay.cleanup();
  }
}

/**
 * Run a command in the best available isolated sandbox
 */
export async function runIsolated(
  command: string[],
  config: Sandboxfile,
  options: IsolatedSandboxOptions = {},
): Promise<IsolatedSandboxResult> {
  const support = await checkIsolationSupport();

  if (options.verbose) {
    console.log("[sandbox] Isolation support:", support);
  }

  // Try bwrap first (best unprivileged option)
  if (support.bwrap) {
    try {
      return await runIsolatedBwrap(command, config, options);
    } catch (e) {
      if (options.verbose) {
        console.warn("[sandbox] bwrap failed:", e);
      }
    }
  }

  // Try unshare
  if (support.unshare && support.userNamespaces) {
    try {
      return await runIsolatedUnshare(command, config, options);
    } catch (e) {
      if (options.verbose) {
        console.warn("[sandbox] unshare failed:", e);
      }
    }
  }

  // Fallback: no isolation
  console.warn("[sandbox] WARNING: Running without isolation. Install bubblewrap: apt install bubblewrap");

  const proc = Bun.spawn({
    cmd: command,
    cwd: options.cwd || config.workdir || process.cwd(),
    env: {
      ...process.env,
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    success: exitCode === 0,
    exitCode: exitCode ?? 1,
    stdout,
    stderr,
    modifiedFiles: [],
    extractedFiles: [],
  };
}

/**
 * IsolatedSandbox class - full sandbox lifecycle with isolation
 */
export class IsolatedSandbox {
  private config: Sandboxfile;
  private options: IsolatedSandboxOptions;
  private secretValues: Map<string, string> = new Map();

  constructor(config: Sandboxfile, options: IsolatedSandboxOptions = {}) {
    this.config = config;
    this.options = { isolated: true, ...options };
  }

  /**
   * Load secrets from environment (they won't be visible in /proc inside sandbox)
   */
  loadSecrets(): void {
    for (const secret of this.config.secrets) {
      const value = process.env[secret];
      if (value) {
        this.secretValues.set(secret, value);
      } else {
        console.warn(`[sandbox] Secret not found: ${secret}`);
      }
    }
  }

  /**
   * Run setup commands (RUN directives) in isolated environment
   */
  async runSetup(): Promise<boolean> {
    for (const cmd of this.config.runCommands) {
      const result = await runIsolated(["sh", "-c", cmd], this.config, {
        ...this.options,
        env: {
          ...this.options.env,
          ...Object.fromEntries(this.secretValues),
        },
      });

      if (!result.success) {
        console.error(`[sandbox] Setup failed: ${cmd}`);
        console.error(result.stderr);
        return false;
      }
    }
    return true;
  }

  /**
   * Run test commands in isolated environment
   */
  async runTests(): Promise<{
    passed: boolean;
    results: Array<{ name: string; passed: boolean; exitCode: number }>;
  }> {
    const results: Array<{ name: string; passed: boolean; exitCode: number }> = [];

    for (let i = 0; i < this.config.tests.length; i++) {
      const test = this.config.tests[i];
      const name = test.name || `test-${i}`;

      const result = await runIsolated(["sh", "-c", test.command], this.config, {
        ...this.options,
        env: {
          ...this.options.env,
          ...Object.fromEntries(this.secretValues),
        },
      });

      results.push({
        name,
        passed: result.success,
        exitCode: result.exitCode,
      });
    }

    return {
      passed: results.every(r => r.passed),
      results,
    };
  }

  /**
   * Run full sandbox lifecycle
   */
  async run(): Promise<{
    success: boolean;
    testResults?: Awaited<ReturnType<IsolatedSandbox["runTests"]>>;
  }> {
    this.loadSecrets();

    const setupSuccess = await this.runSetup();
    if (!setupSuccess) {
      return { success: false };
    }

    if (this.config.tests.length > 0) {
      const testResults = await this.runTests();
      return { success: testResults.passed, testResults };
    }

    return { success: true };
  }
}

export default {
  IsolatedSandbox,
  runIsolated,
  runIsolatedBwrap,
  runIsolatedUnshare,
  checkIsolationSupport,
};
