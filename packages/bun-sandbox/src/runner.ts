/**
 * Sandboxfile Runner
 *
 * Executes sandboxes based on Sandboxfile configuration.
 */

import type { Sandboxfile, SandboxProcess } from "./parser";
import { loadSandboxfile, parseSandboxfile } from "./parser";

export interface RunnerOptions {
  /** Working directory for the sandbox */
  cwd?: string;
  /** Environment variables to pass to processes */
  env?: Record<string, string>;
  /** Whether to run in verbose mode */
  verbose?: boolean;
  /** Whether to run in dry-run mode (don't actually execute) */
  dryRun?: boolean;
  /** Timeout for RUN commands in milliseconds */
  runTimeout?: number;
  /** Callback for log output */
  onLog?: (source: string, message: string) => void;
}

export interface ProcessHandle {
  name: string;
  type: "dev" | "service" | "test";
  process: ReturnType<typeof Bun.spawn>;
  port?: number;
}

export interface RunResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Manages sandbox execution
 */
export class SandboxRunner {
  private config: Sandboxfile;
  private options: RunnerOptions;
  private runningProcesses: Map<string, ProcessHandle> = new Map();
  private workdir: string;
  private sandboxEnv: Record<string, string>;

  constructor(config: Sandboxfile, options: RunnerOptions = {}) {
    this.config = config;
    this.options = options;
    this.workdir = options.cwd || process.cwd();
    this.sandboxEnv = this.buildEnvironment();
  }

  /**
   * Load a SandboxRunner from a Sandboxfile path
   */
  static async fromFile(path: string, options: RunnerOptions = {}): Promise<SandboxRunner> {
    const config = await loadSandboxfile(path);
    return new SandboxRunner(config, options);
  }

  /**
   * Load a SandboxRunner from a Sandboxfile string
   */
  static fromString(content: string, options: RunnerOptions = {}): SandboxRunner {
    const config = parseSandboxfile(content);
    return new SandboxRunner(config, options);
  }

  /**
   * Build the environment for sandbox processes
   */
  private buildEnvironment(): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      ...this.options.env,
    } as Record<string, string>;

    // Add secrets as environment variables (but mark them as secrets)
    for (const secret of this.config.secrets) {
      const value = process.env[secret];
      if (value !== undefined) {
        env[secret] = value;
      }
    }

    return env;
  }

  /**
   * Check if a host is allowed by NET rules
   */
  isNetworkAllowed(host: string): boolean {
    if (this.config.netHosts.length === 0) {
      // No NET rules = deny all external
      return false;
    }

    for (const pattern of this.config.netHosts) {
      if (pattern === "*") {
        return true;
      }
      if (pattern.startsWith("*.")) {
        // Wildcard subdomain match
        const suffix = pattern.slice(1); // ".example.com"
        if (host.endsWith(suffix) || host === pattern.slice(2)) {
          return true;
        }
      } else if (host === pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Log a message
   */
  private log(source: string, message: string): void {
    if (this.options.onLog) {
      this.options.onLog(source, message);
    } else if (this.options.verbose) {
      console.log(`[${source}] ${message}`);
    }
  }

  /**
   * Run a shell command and wait for completion
   */
  private async runCommand(command: string, label: string): Promise<RunResult> {
    this.log(label, `Running: ${command}`);

    if (this.options.dryRun) {
      this.log(label, "(dry-run) Would execute command");
      return { success: true, exitCode: 0, stdout: "", stderr: "" };
    }

    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: this.workdir,
      env: this.sandboxEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const success = exitCode === 0;

    if (!success) {
      this.log(label, `Command failed with exit code ${exitCode}`);
      if (stderr) {
        this.log(label, `stderr: ${stderr}`);
      }
    }

    return { success, exitCode, stdout, stderr };
  }

  /**
   * Start a background process
   */
  private startProcess(processConfig: SandboxProcess, type: "dev" | "service" | "test"): ProcessHandle {
    const name = processConfig.name || type;
    const command = processConfig.command;

    this.log(name, `Starting ${type}: ${command}`);

    if (this.options.dryRun) {
      this.log(name, "(dry-run) Would start process");
      // Return a dummy handle
      return {
        name,
        type,
        process: null as unknown as ReturnType<typeof Bun.spawn>,
        port: processConfig.port,
      };
    }

    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: this.workdir,
      env: this.sandboxEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const handle: ProcessHandle = {
      name,
      type,
      process: proc,
      port: processConfig.port,
    };

    this.runningProcesses.set(name, handle);

    // Log output in background
    this.pipeOutput(proc, name);

    return handle;
  }

  /**
   * Pipe process output to logs
   */
  private async pipeOutput(proc: ReturnType<typeof Bun.spawn>, name: string): Promise<void> {
    const readStream = async (stream: ReadableStream<Uint8Array> | null, prefix: string) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          for (const line of text.split("\n")) {
            if (line.trim()) {
              this.log(name, `${prefix}${line}`);
            }
          }
        }
      } catch {
        // Stream closed
      }
    };

    // Don't await - run in background
    readStream(proc.stdout, "");
    readStream(proc.stderr, "[err] ");
  }

  /**
   * Wait for a process to be ready (e.g., port is listening)
   */
  private async waitForReady(handle: ProcessHandle, timeoutMs: number = 30000): Promise<boolean> {
    if (!handle.port) {
      // No port specified, wait a bit and assume ready
      await Bun.sleep(500);
      return true;
    }

    const startTime = Date.now();
    const port = handle.port;

    this.log(handle.name, `Waiting for port ${port} to be ready...`);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const socket = await Bun.connect({
          hostname: "127.0.0.1",
          port,
          socket: {
            data() {},
            open(socket) {
              socket.end();
            },
            close() {},
            error() {},
          },
        });
        socket.end();
        this.log(handle.name, `Port ${port} is ready`);
        return true;
      } catch {
        // Port not ready yet
        await Bun.sleep(100);
      }
    }

    this.log(handle.name, `Timeout waiting for port ${port}`);
    return false;
  }

  /**
   * Run all RUN commands (setup phase)
   */
  async runSetup(): Promise<boolean> {
    this.log("setup", "Starting setup phase...");

    for (const command of this.config.runCommands) {
      const result = await this.runCommand(command, "setup");
      if (!result.success) {
        this.log("setup", `Setup failed: ${command}`);
        return false;
      }
    }

    this.log("setup", "Setup complete");
    return true;
  }

  /**
   * Start all services
   */
  async startServices(): Promise<boolean> {
    this.log("services", "Starting services...");

    for (const service of this.config.services) {
      const handle = this.startProcess(service, "service");
      if (handle.port) {
        const ready = await this.waitForReady(handle);
        if (!ready) {
          this.log("services", `Service ${handle.name} failed to start`);
          return false;
        }
      }
    }

    this.log("services", "All services started");
    return true;
  }

  /**
   * Start the dev server
   */
  async startDev(): Promise<ProcessHandle | null> {
    if (!this.config.dev) {
      this.log("dev", "No DEV server configured");
      return null;
    }

    const handle = this.startProcess(this.config.dev, "dev");

    if (handle.port) {
      const ready = await this.waitForReady(handle);
      if (!ready) {
        this.log("dev", "Dev server failed to start");
        return null;
      }
    }

    return handle;
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<boolean> {
    this.log("tests", "Running tests...");

    let allPassed = true;

    for (const test of this.config.tests) {
      const name = test.name || "test";
      const result = await this.runCommand(test.command, name);
      if (!result.success) {
        allPassed = false;
        this.log(name, `Test failed with exit code ${result.exitCode}`);
      } else {
        this.log(name, "Test passed");
      }
    }

    return allPassed;
  }

  /**
   * Stop all running processes
   */
  async stopAll(): Promise<void> {
    this.log("cleanup", "Stopping all processes...");

    for (const [name, handle] of this.runningProcesses) {
      if (handle.process) {
        this.log("cleanup", `Stopping ${name}...`);
        handle.process.kill();
        await handle.process.exited;
      }
    }

    this.runningProcesses.clear();
    this.log("cleanup", "All processes stopped");
  }

  /**
   * Collect OUTPUT files
   */
  async collectOutputs(destDir: string): Promise<string[]> {
    const collectedFiles: string[] = [];

    for (const pattern of this.config.outputs) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: this.workdir })) {
        const srcPath = `${this.workdir}/${file}`;
        const destPath = `${destDir}/${file}`;

        // Create destination directory
        const destDirPath = destPath.substring(0, destPath.lastIndexOf("/"));
        await Bun.$`mkdir -p ${destDirPath}`.quiet();

        // Copy file
        await Bun.$`cp -r ${srcPath} ${destPath}`.quiet();
        collectedFiles.push(file);
      }
    }

    return collectedFiles;
  }

  /**
   * Run the full sandbox lifecycle
   */
  async run(): Promise<{ success: boolean; testsPassed: boolean }> {
    try {
      // Resolve workdir
      if (this.config.workdir) {
        if (this.config.workdir.startsWith("/")) {
          this.workdir = this.config.workdir;
        } else {
          this.workdir = `${this.workdir}/${this.config.workdir}`;
        }
      }

      // Setup phase
      const setupOk = await this.runSetup();
      if (!setupOk) {
        return { success: false, testsPassed: false };
      }

      // Start services
      const servicesOk = await this.startServices();
      if (!servicesOk) {
        await this.stopAll();
        return { success: false, testsPassed: false };
      }

      // Start dev server (if configured)
      await this.startDev();

      // Run tests
      const testsPassed = await this.runTests();

      return { success: true, testsPassed };
    } finally {
      await this.stopAll();
    }
  }

  /**
   * Get the parsed configuration
   */
  getConfig(): Sandboxfile {
    return this.config;
  }

  /**
   * Get running processes
   */
  getRunningProcesses(): Map<string, ProcessHandle> {
    return this.runningProcesses;
  }
}
