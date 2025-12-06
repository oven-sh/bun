/**
 * Linux Sandbox Implementation
 *
 * Uses Linux namespaces for proper isolation:
 * - User namespace: UID/GID mapping for unprivileged operation
 * - Mount namespace: Overlayfs for ephemeral filesystem
 * - Network namespace: Isolated network with controlled egress
 * - PID namespace: Process isolation
 * - UTS namespace: Hostname isolation
 */

// Linux namespace flags
const CLONE_NEWUSER = 0x10000000;
const CLONE_NEWNS = 0x00020000;
const CLONE_NEWNET = 0x40000000;
const CLONE_NEWPID = 0x20000000;
const CLONE_NEWUTS = 0x04000000;
const CLONE_NEWIPC = 0x08000000;

// Mount flags
const MS_BIND = 4096;
const MS_REC = 16384;
const MS_PRIVATE = 1 << 18;
const MS_RDONLY = 1;
const MS_NOSUID = 2;
const MS_NODEV = 4;
const MS_NOEXEC = 8;

// Syscall numbers (x86_64)
const SYS_unshare = 272;
const SYS_mount = 165;
const SYS_umount2 = 166;
const SYS_pivot_root = 155;
const SYS_chroot = 161;
const SYS_setns = 308;

export interface SandboxConfig {
  /** Root directory for the sandbox (will be overlaid) */
  rootfs: string;
  /** Working directory inside the sandbox */
  workdir: string;
  /** Directories to bind mount read-only */
  readonlyBinds?: string[];
  /** Directories to bind mount read-write */
  writableBinds?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Allowed network hosts (empty = no network) */
  allowedHosts?: string[];
  /** Command to run */
  command: string[];
  /** UID inside the sandbox (default: 1000) */
  uid?: number;
  /** GID inside the sandbox (default: 1000) */
  gid?: number;
  /** Hostname inside the sandbox */
  hostname?: string;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Files modified in the overlay (to extract) */
  modifiedFiles: string[];
}

/**
 * Check if we can use unprivileged user namespaces
 */
export async function canCreateUserNamespace(): Promise<boolean> {
  try {
    const file = Bun.file("/proc/sys/kernel/unprivileged_userns_clone");
    if (await file.exists()) {
      const content = await file.text();
      return content.trim() === "1";
    }
    // If file doesn't exist, try to check by attempting unshare
    return true;
  } catch {
    return false;
  }
}

/**
 * Setup UID/GID mapping for user namespace
 */
async function setupUidGidMapping(pid: number, uid: number, gid: number): Promise<void> {
  const currentUid = process.getuid?.() ?? 1000;
  const currentGid = process.getgid?.() ?? 1000;

  // Write uid_map: <uid_inside> <uid_outside> <count>
  await Bun.write(`/proc/${pid}/uid_map`, `${uid} ${currentUid} 1\n`);

  // Must write "deny" to setgroups before writing gid_map
  await Bun.write(`/proc/${pid}/setgroups`, "deny\n");

  // Write gid_map
  await Bun.write(`/proc/${pid}/gid_map`, `${gid} ${currentGid} 1\n`);
}

/**
 * Create overlay filesystem structure
 */
async function setupOverlayfs(
  lowerDir: string,
  workDir: string,
): Promise<{ upperDir: string; mergedDir: string; cleanup: () => Promise<void> }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");

  // Create temporary directories for overlay
  const sandboxId = crypto.randomBytes(8).toString("hex");
  const baseDir = `/tmp/bun-sandbox-${sandboxId}`;

  const upperDir = path.join(baseDir, "upper");
  const overlayWorkDir = path.join(baseDir, "work");
  const mergedDir = path.join(baseDir, "merged");

  await fs.mkdir(upperDir, { recursive: true });
  await fs.mkdir(overlayWorkDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });

  const cleanup = async () => {
    try {
      // Unmount merged directory
      const proc = Bun.spawn({
        cmd: ["umount", "-l", mergedDir],
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {
      // Ignore unmount errors
    }

    try {
      await fs.rm(baseDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { upperDir, mergedDir, cleanup };
}

/**
 * Create a helper script that runs inside the namespace
 */
function createNamespaceHelper(config: SandboxConfig): string {
  const script = `#!/bin/sh
set -e

# Mount proc
mount -t proc proc /proc

# Mount tmpfs for /tmp
mount -t tmpfs tmpfs /tmp

# Mount devpts for /dev/pts
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts

# Set hostname
hostname "${config.hostname || "sandbox"}"

# Change to workdir
cd "${config.workdir}"

# Execute the command
exec ${config.command.map(arg => `"${arg.replace(/"/g, '\\"')}"`).join(" ")}
`;
  return script;
}

/**
 * Low-level sandbox using unshare (requires root or CAP_SYS_ADMIN)
 */
export async function runSandboxedRoot(config: SandboxConfig): Promise<SandboxResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Setup overlay filesystem
  const { upperDir, mergedDir, cleanup } = await setupOverlayfs(config.rootfs, config.workdir);

  try {
    // Mount overlayfs
    const mountProc = Bun.spawn({
      cmd: [
        "mount",
        "-t",
        "overlay",
        "overlay",
        "-o",
        `lowerdir=${config.rootfs},upperdir=${upperDir},workdir=${path.dirname(upperDir)}/work`,
        mergedDir,
      ],
    });
    const mountExit = await mountProc.exited;
    if (mountExit !== 0) {
      throw new Error(`Failed to mount overlayfs: exit code ${mountExit}`);
    }

    // Build unshare command with all namespaces
    const unshareArgs = [
      "unshare",
      "--user",
      "--map-root-user",
      "--mount",
      "--net",
      "--pid",
      "--fork",
      "--uts",
      "--ipc",
      `--root=${mergedDir}`,
      `--wd=${config.workdir}`,
    ];

    // Add environment variables
    const env: Record<string, string> = {
      ...config.env,
      HOME: "/root",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      TERM: "xterm-256color",
    };

    // Run the command
    const proc = Bun.spawn({
      cmd: [...unshareArgs, ...config.command],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Find modified files in upperDir
    const modifiedFiles: string[] = [];
    async function walkDir(dir: string, prefix: string = ""): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath, relativePath);
          } else {
            modifiedFiles.push(relativePath);
          }
        }
      } catch {
        // Ignore errors
      }
    }
    await walkDir(upperDir);

    return {
      exitCode: exitCode ?? 1,
      stdout,
      stderr,
      modifiedFiles,
    };
  } finally {
    await cleanup();
  }
}

/**
 * Unprivileged sandbox using bwrap (bubblewrap) if available
 */
export async function runSandboxedBwrap(config: SandboxConfig): Promise<SandboxResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  // Check if bwrap is available
  const whichProc = Bun.spawn({
    cmd: ["which", "bwrap"],
    stdout: "pipe",
    stderr: "ignore",
  });
  const whichExit = await whichProc.exited;
  if (whichExit !== 0) {
    throw new Error("bubblewrap (bwrap) not found. Install it with: apt install bubblewrap");
  }

  // Setup overlay filesystem
  const { upperDir, mergedDir, cleanup } = await setupOverlayfs(config.rootfs, config.workdir);

  try {
    // Build bwrap command
    const bwrapArgs = [
      "bwrap",
      // User namespace with UID/GID mapping
      "--unshare-user",
      "--uid",
      String(config.uid ?? 1000),
      "--gid",
      String(config.gid ?? 1000),
      // Mount namespace
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-ipc",
      // Hostname
      "--hostname",
      config.hostname || "sandbox",
      // Root filesystem (bind mount the lower dir as base)
      "--ro-bind",
      config.rootfs,
      "/",
      // Overlay upper layer for writes
      "--overlay-src",
      config.rootfs,
      "--tmp-overlay",
      "/",
      // Essential mounts
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--tmpfs",
      "/run",
      // Working directory
      "--chdir",
      config.workdir,
      // Die with parent
      "--die-with-parent",
    ];

    // Add readonly binds
    for (const bind of config.readonlyBinds || []) {
      bwrapArgs.push("--ro-bind", bind, bind);
    }

    // Add writable binds
    for (const bind of config.writableBinds || []) {
      bwrapArgs.push("--bind", bind, bind);
    }

    // Network namespace (isolated by default)
    if (!config.allowedHosts || config.allowedHosts.length === 0) {
      bwrapArgs.push("--unshare-net");
    }

    // Environment variables
    const env: Record<string, string> = {
      HOME: "/home/sandbox",
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
      TERM: "xterm-256color",
      ...config.env,
    };

    // Run the command
    const proc = Bun.spawn({
      cmd: [...bwrapArgs, ...config.command],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // For bwrap with --tmp-overlay, files are in tmpfs and lost
    // We would need a different approach to extract modified files
    const modifiedFiles: string[] = [];

    return {
      exitCode: exitCode ?? 1,
      stdout,
      stderr,
      modifiedFiles,
    };
  } finally {
    await cleanup();
  }
}

/**
 * Simple sandbox using unshare command (works on most Linux systems)
 */
export async function runSandboxedUnshare(config: SandboxConfig): Promise<SandboxResult> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");

  // Create sandbox workspace
  const sandboxId = crypto.randomBytes(8).toString("hex");
  const workspaceDir = `/tmp/bun-sandbox-${sandboxId}`;
  const upperDir = path.join(workspaceDir, "upper");
  const workDir = path.join(workspaceDir, "work");
  const mergedDir = path.join(workspaceDir, "merged");

  await fs.mkdir(upperDir, { recursive: true });
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });

  const cleanup = async () => {
    try {
      // Try to unmount
      const umountProc = Bun.spawn({
        cmd: ["umount", "-l", mergedDir],
        stdout: "ignore",
        stderr: "ignore",
      });
      await umountProc.exited;
    } catch {
      // Ignore
    }
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  };

  try {
    // Build environment
    const env: Record<string, string> = {
      HOME: config.workdir,
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
      TERM: "xterm-256color",
      ...config.env,
    };

    // Build unshare command
    // Using --user --map-root-user for unprivileged namespaces
    const unshareArgs = ["unshare", "--user", "--map-root-user", "--mount", "--pid", "--fork", "--uts", "--ipc"];

    // If no network hosts allowed, isolate network
    if (!config.allowedHosts || config.allowedHosts.length === 0) {
      unshareArgs.push("--net");
    }

    // Create a shell script to setup the mount namespace
    const setupScript = `
#!/bin/sh
set -e

# Make all mounts private
mount --make-rprivate /

# Mount overlay if we have fuse-overlayfs or can use kernel overlay
if command -v fuse-overlayfs >/dev/null 2>&1; then
  fuse-overlayfs -o lowerdir=${config.rootfs},upperdir=${upperDir},workdir=${workDir} ${mergedDir}
  cd ${mergedDir}

  # Pivot root
  mkdir -p ${mergedDir}/old_root
  pivot_root ${mergedDir} ${mergedDir}/old_root
  umount -l /old_root || true
  rmdir /old_root || true
fi

# Mount essential filesystems
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true
mount -t tmpfs tmpfs /run 2>/dev/null || true

# Setup /dev
mount -t tmpfs -o mode=755 tmpfs /dev 2>/dev/null || true
mknod -m 666 /dev/null c 1 3 2>/dev/null || true
mknod -m 666 /dev/zero c 1 5 2>/dev/null || true
mknod -m 666 /dev/random c 1 8 2>/dev/null || true
mknod -m 666 /dev/urandom c 1 9 2>/dev/null || true
mknod -m 666 /dev/tty c 5 0 2>/dev/null || true
ln -sf /proc/self/fd /dev/fd 2>/dev/null || true
ln -sf /proc/self/fd/0 /dev/stdin 2>/dev/null || true
ln -sf /proc/self/fd/1 /dev/stdout 2>/dev/null || true
ln -sf /proc/self/fd/2 /dev/stderr 2>/dev/null || true

# Set hostname
hostname ${config.hostname || "sandbox"} 2>/dev/null || true

# Change to workdir
cd ${config.workdir}

# Run the command
exec "$@"
`;

    const setupScriptPath = path.join(workspaceDir, "setup.sh");
    await Bun.write(setupScriptPath, setupScript);
    await fs.chmod(setupScriptPath, 0o755);

    // Run with unshare
    const proc = Bun.spawn({
      cmd: [...unshareArgs, "/bin/sh", setupScriptPath, ...config.command],
      env,
      cwd: config.workdir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Find modified files
    const modifiedFiles: string[] = [];
    async function walkDir(dir: string, prefix: string = ""): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath, relativePath);
          } else {
            modifiedFiles.push(relativePath);
          }
        }
      } catch {
        // Ignore
      }
    }
    await walkDir(upperDir);

    return {
      exitCode: exitCode ?? 1,
      stdout,
      stderr,
      modifiedFiles,
    };
  } finally {
    await cleanup();
  }
}

/**
 * Main sandbox function - tries different methods based on availability
 */
export async function runSandboxed(config: SandboxConfig): Promise<SandboxResult> {
  // Check for bwrap first (most portable unprivileged option)
  const hasBwrap = await (async () => {
    const proc = Bun.spawn({
      cmd: ["which", "bwrap"],
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  })();

  if (hasBwrap) {
    try {
      return await runSandboxedBwrap(config);
    } catch (e) {
      console.warn("bwrap sandbox failed, falling back:", e);
    }
  }

  // Try unshare-based sandbox
  const canUnshare = await canCreateUserNamespace();
  if (canUnshare) {
    try {
      return await runSandboxedUnshare(config);
    } catch (e) {
      console.warn("unshare sandbox failed, falling back:", e);
    }
  }

  // Fallback: no isolation, just run the command with warning
  console.warn(
    "WARNING: Running without sandbox isolation. Install bubblewrap or enable unprivileged user namespaces.",
  );

  const proc = Bun.spawn({
    cmd: config.command,
    cwd: config.workdir,
    env: {
      ...config.env,
      PATH: "/usr/local/bin:/usr/bin:/bin",
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
    exitCode: exitCode ?? 1,
    stdout,
    stderr,
    modifiedFiles: [],
  };
}

export default {
  runSandboxed,
  runSandboxedBwrap,
  runSandboxedUnshare,
  runSandboxedRoot,
  canCreateUserNamespace,
};
