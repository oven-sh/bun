/**
 * Sandboxfile Runtime
 *
 * Executes agent sandboxes based on Sandboxfile declarations.
 * Provides ephemeral environments with controlled network access,
 * secret management, and output extraction.
 */

// Types
export interface SandboxProcess {
  name?: string;
  command: string;
  port?: number;
  watch?: string;
}

export interface SandboxService {
  name: string;
  command: string;
  port?: number;
  watch?: string;
}

export interface Sandboxfile {
  from?: string;
  workdir?: string;
  runCommands: string[];
  dev?: SandboxProcess;
  services: SandboxService[];
  tests: SandboxProcess[];
  outputs: string[];
  logs: string[];
  net: string[];
  secrets: string[];
  infer?: string;
}

export interface SandboxOptions {
  /** Working directory for the sandbox */
  cwd?: string;
  /** Environment variables to pass through */
  env?: Record<string, string>;
  /** Callback for stdout data */
  onStdout?: (service: string, data: string) => void;
  /** Callback for stderr data */
  onStderr?: (service: string, data: string) => void;
  /** Callback when a service exits */
  onExit?: (service: string, code: number | null) => void;
  /** Enable verbose logging */
  verbose?: boolean;
}

interface RunningProcess {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  type: "run" | "dev" | "service" | "test";
}

/**
 * Sandbox Runtime - manages the lifecycle of a sandbox environment
 */
export class Sandbox {
  private config: Sandboxfile;
  private options: SandboxOptions;
  private processes: Map<string, RunningProcess> = new Map();
  private workdir: string;
  private secretValues: Map<string, string> = new Map();
  private aborted = false;

  constructor(config: Sandboxfile, options: SandboxOptions = {}) {
    this.config = config;
    this.options = options;
    this.workdir = this.resolveWorkdir();
  }

  private resolveWorkdir(): string {
    const base = this.options.cwd || process.cwd();
    if (!this.config.workdir || this.config.workdir === ".") {
      return base;
    }
    // Check if workdir is absolute
    if (this.config.workdir.startsWith("/")) {
      return this.config.workdir;
    }
    return `${base}/${this.config.workdir}`;
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[sandbox] ${message}`);
    }
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...this.options.env,
    };

    // Add secrets (values loaded from environment)
    for (const secretName of this.config.secrets) {
      const value = this.secretValues.get(secretName);
      if (value !== undefined) {
        env[secretName] = value;
      }
    }

    return env;
  }

  /**
   * Load secret values from the environment
   * Secrets are loaded once at startup and redacted from inspection
   */
  loadSecrets(): void {
    for (const secretName of this.config.secrets) {
      const value = process.env[secretName] || this.options.env?.[secretName];
      if (value !== undefined) {
        this.secretValues.set(secretName, value);
        this.log(`Loaded secret: ${secretName}`);
      } else {
        console.warn(`[sandbox] Warning: Secret ${secretName} not found in environment`);
      }
    }
  }

  /**
   * Validate network access for a given hostname
   */
  isNetworkAllowed(hostname: string): boolean {
    // If no NET rules, deny all external access
    if (this.config.net.length === 0) {
      return false;
    }

    // Check if hostname matches any allowed pattern
    for (const allowed of this.config.net) {
      if (hostname === allowed) {
        return true;
      }
      // Support wildcard subdomains (e.g., *.example.com)
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2);
        if (hostname.endsWith(domain) || hostname === domain.slice(1)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Parse a command string into argv array
   */
  private parseCommand(cmd: string): string[] {
    const args: string[] = [];
    let current = "";
    let inQuote = false;
    let quoteChar = "";

    for (let i = 0; i < cmd.length; i++) {
      const char = cmd[i];

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
      } else if (char === " " || char === "\t") {
        if (current) {
          args.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  /**
   * Spawn a process with the given command
   */
  private async spawnProcess(name: string, command: string, type: RunningProcess["type"]): Promise<RunningProcess> {
    const args = this.parseCommand(command);
    const env = this.buildEnv();

    this.log(`Starting ${type} "${name}": ${command}`);

    const proc = Bun.spawn({
      cmd: args,
      cwd: this.workdir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const running: RunningProcess = { name, proc, type };
    this.processes.set(name, running);

    // Handle stdout
    if (proc.stdout) {
      this.streamOutput(name, proc.stdout, "stdout");
    }

    // Handle stderr
    if (proc.stderr) {
      this.streamOutput(name, proc.stderr, "stderr");
    }

    // Handle exit
    proc.exited.then(code => {
      this.log(`${type} "${name}" exited with code ${code}`);
      this.processes.delete(name);
      this.options.onExit?.(name, code);
    });

    return running;
  }

  private async streamOutput(
    name: string,
    stream: ReadableStream<Uint8Array>,
    type: "stdout" | "stderr",
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        if (type === "stdout") {
          this.options.onStdout?.(name, text);
        } else {
          this.options.onStderr?.(name, text);
        }
      }
    } catch {
      // Stream closed, ignore
    }
  }

  /**
   * Run setup commands (RUN directives)
   */
  async runSetup(): Promise<boolean> {
    for (const cmd of this.config.runCommands) {
      if (this.aborted) return false;

      this.log(`Running setup: ${cmd}`);
      const args = this.parseCommand(cmd);

      const proc = Bun.spawn({
        cmd: args,
        cwd: this.workdir,
        env: this.buildEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });

      // Stream output
      if (proc.stdout) {
        this.streamOutput("setup", proc.stdout, "stdout");
      }
      if (proc.stderr) {
        this.streamOutput("setup", proc.stderr, "stderr");
      }

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        console.error(`[sandbox] Setup command failed with code ${exitCode}: ${cmd}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Start all services defined in the Sandboxfile
   */
  async startServices(): Promise<void> {
    for (const service of this.config.services) {
      if (this.aborted) return;
      await this.spawnProcess(service.name, service.command, "service");
    }
  }

  /**
   * Start the dev server if defined
   */
  async startDev(): Promise<RunningProcess | null> {
    if (!this.config.dev) return null;

    const name = this.config.dev.name || "dev";
    return this.spawnProcess(name, this.config.dev.command, "dev");
  }

  /**
   * Run test commands
   */
  async runTests(): Promise<{
    passed: boolean;
    results: Array<{ name: string; passed: boolean; exitCode: number | null }>;
  }> {
    const results: Array<{ name: string; passed: boolean; exitCode: number | null }> = [];

    for (let i = 0; i < this.config.tests.length; i++) {
      if (this.aborted) break;

      const test = this.config.tests[i];
      const name = test.name || `test-${i}`;

      this.log(`Running test: ${name}`);
      const args = this.parseCommand(test.command);

      const proc = Bun.spawn({
        cmd: args,
        cwd: this.workdir,
        env: this.buildEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });

      // Stream output
      if (proc.stdout) {
        this.streamOutput(name, proc.stdout, "stdout");
      }
      if (proc.stderr) {
        this.streamOutput(name, proc.stderr, "stderr");
      }

      const exitCode = await proc.exited;
      const passed = exitCode === 0;

      results.push({ name, passed, exitCode });

      if (!passed) {
        this.log(`Test "${name}" failed with code ${exitCode}`);
      }
    }

    return {
      passed: results.every(r => r.passed),
      results,
    };
  }

  /**
   * Extract output files from the sandbox
   */
  async extractOutputs(destDir: string): Promise<string[]> {
    const extracted: string[] = [];
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    for (const pattern of this.config.outputs) {
      const glob = new Bun.Glob(pattern);
      const matches = glob.scanSync({ cwd: this.workdir });

      for (const match of matches) {
        const srcPath = path.join(this.workdir, match);
        const destPath = path.join(destDir, match);

        // Ensure destination directory exists
        await fs.mkdir(path.dirname(destPath), { recursive: true });

        // Copy file
        await fs.copyFile(srcPath, destPath);
        extracted.push(match);
        this.log(`Extracted: ${match}`);
      }
    }

    return extracted;
  }

  /**
   * Get log file paths matching LOGS patterns
   */
  getLogFiles(): string[] {
    const logFiles: string[] = [];

    for (const pattern of this.config.logs) {
      const glob = new Bun.Glob(pattern);
      const matches = glob.scanSync({ cwd: this.workdir });

      for (const match of matches) {
        logFiles.push(`${this.workdir}/${match}`);
      }
    }

    return logFiles;
  }

  /**
   * Tail log files
   */
  async tailLogs(callback: (file: string, line: string) => void): Promise<() => void> {
    const fs = await import("node:fs");
    const watchers: ReturnType<typeof fs.watch>[] = [];
    const filePositions = new Map<string, number>();

    for (const logFile of this.getLogFiles()) {
      try {
        // Get initial file size
        const stats = fs.statSync(logFile);
        filePositions.set(logFile, stats.size);

        // Watch for changes
        const watcher = fs.watch(logFile, async eventType => {
          if (eventType === "change") {
            const currentPos = filePositions.get(logFile) || 0;
            const file = Bun.file(logFile);
            const newContent = await file.slice(currentPos).text();

            if (newContent) {
              const lines = newContent.split("\n");
              for (const line of lines) {
                if (line) callback(logFile, line);
              }
              filePositions.set(logFile, currentPos + newContent.length);
            }
          }
        });

        watchers.push(watcher);
      } catch {
        // File doesn't exist yet, ignore
      }
    }

    // Return cleanup function
    return () => {
      for (const watcher of watchers) {
        watcher.close();
      }
    };
  }

  /**
   * Stop all running processes
   */
  async stop(): Promise<void> {
    this.aborted = true;

    for (const [name, running] of this.processes) {
      this.log(`Stopping ${running.type} "${name}"`);
      running.proc.kill();
    }

    // Wait for all processes to exit
    const exitPromises = Array.from(this.processes.values()).map(r => r.proc.exited);
    await Promise.all(exitPromises);

    this.processes.clear();
  }

  /**
   * Get the status of all running processes
   */
  getStatus(): Array<{ name: string; type: string; pid: number }> {
    return Array.from(this.processes.values()).map(r => ({
      name: r.name,
      type: r.type,
      pid: r.proc.pid,
    }));
  }

  /**
   * Check if any services are still running
   */
  isRunning(): boolean {
    return this.processes.size > 0;
  }

  /**
   * Run the full sandbox lifecycle
   */
  async run(): Promise<{
    success: boolean;
    testResults?: Awaited<ReturnType<Sandbox["runTests"]>>;
  }> {
    try {
      // Load secrets
      this.loadSecrets();

      // Run setup commands
      const setupSuccess = await this.runSetup();
      if (!setupSuccess) {
        return { success: false };
      }

      // Start services
      await this.startServices();

      // Start dev server
      await this.startDev();

      // Run tests if defined
      if (this.config.tests.length > 0) {
        // Give services time to start
        await new Promise(resolve => setTimeout(resolve, 1000));

        const testResults = await this.runTests();
        return { success: testResults.passed, testResults };
      }

      return { success: true };
    } catch (err) {
      console.error("[sandbox] Error:", err);
      return { success: false };
    }
  }
}

/**
 * Parse a Sandboxfile from a string
 */
export function parseSandboxfile(src: string): Sandboxfile {
  const result: Sandboxfile = {
    runCommands: [],
    services: [],
    tests: [],
    outputs: [],
    logs: [],
    net: [],
    secrets: [],
  };

  const lines = src.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum].trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith("#")) continue;

    const spaceIdx = line.indexOf(" ");
    const directive = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line;
    const rest = spaceIdx >= 0 ? line.slice(spaceIdx + 1).trimStart() : "";

    switch (directive) {
      case "FROM":
        if (!rest) throw new Error(`Line ${lineNum + 1}: FROM requires an argument`);
        if (result.from !== undefined) throw new Error(`Line ${lineNum + 1}: Duplicate FROM directive`);
        result.from = rest;
        break;

      case "WORKDIR":
        if (!rest) throw new Error(`Line ${lineNum + 1}: WORKDIR requires a path argument`);
        if (result.workdir !== undefined) throw new Error(`Line ${lineNum + 1}: Duplicate WORKDIR directive`);
        result.workdir = rest;
        break;

      case "RUN":
        if (!rest) throw new Error(`Line ${lineNum + 1}: RUN requires a command argument`);
        result.runCommands.push(rest);
        break;

      case "DEV":
        if (!rest) throw new Error(`Line ${lineNum + 1}: DEV requires a command argument`);
        if (result.dev !== undefined) throw new Error(`Line ${lineNum + 1}: Duplicate DEV directive`);
        result.dev = parseProcess(rest, false, lineNum);
        break;

      case "SERVICE": {
        if (!rest) throw new Error(`Line ${lineNum + 1}: SERVICE requires a name and command`);
        const proc = parseProcess(rest, true, lineNum);
        if (!proc.name) throw new Error(`Line ${lineNum + 1}: SERVICE requires a name`);
        result.services.push({
          name: proc.name,
          command: proc.command,
          ...(proc.port !== undefined && { port: proc.port }),
          ...(proc.watch !== undefined && { watch: proc.watch }),
        });
        break;
      }

      case "TEST":
        if (!rest) throw new Error(`Line ${lineNum + 1}: TEST requires a command argument`);
        result.tests.push(parseProcess(rest, false, lineNum));
        break;

      case "OUTPUT":
        if (!rest) throw new Error(`Line ${lineNum + 1}: OUTPUT requires a path argument`);
        result.outputs.push(rest);
        break;

      case "LOGS":
        if (!rest) throw new Error(`Line ${lineNum + 1}: LOGS requires a path pattern argument`);
        result.logs.push(rest);
        break;

      case "NET":
        if (!rest) throw new Error(`Line ${lineNum + 1}: NET requires a hostname argument`);
        result.net.push(rest);
        break;

      case "SECRET":
        if (!rest) throw new Error(`Line ${lineNum + 1}: SECRET requires an environment variable name`);
        if (!/^[A-Za-z0-9_]+$/.test(rest)) {
          throw new Error(`Line ${lineNum + 1}: SECRET name must be a valid environment variable name`);
        }
        result.secrets.push(rest);
        break;

      case "INFER":
        if (!rest) throw new Error(`Line ${lineNum + 1}: INFER requires a pattern argument`);
        if (result.infer !== undefined) throw new Error(`Line ${lineNum + 1}: Duplicate INFER directive`);
        result.infer = rest;
        break;

      default:
        throw new Error(`Line ${lineNum + 1}: Unknown directive: ${directive}`);
    }
  }

  return result;
}

function parseProcess(input: string, requireName: boolean, lineNum: number): SandboxProcess {
  const result: SandboxProcess = { command: "" };
  let rest = input;
  let hasName = false;

  while (rest.length > 0) {
    const spaceIdx = rest.search(/[ \t]/);
    const token = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;

    if (token.startsWith("PORT=")) {
      const port = parseInt(token.slice(5), 10);
      if (isNaN(port)) throw new Error(`Line ${lineNum + 1}: Invalid PORT value: ${token.slice(5)}`);
      result.port = port;
    } else if (token.startsWith("WATCH=")) {
      result.watch = token.slice(6);
    } else if (!hasName && !requireName) {
      // For DEV/TEST, first non-option token starts the command
      result.command = rest;
      break;
    } else if (!hasName) {
      // First non-option token is the name
      result.name = token;
      hasName = true;
    } else {
      // Rest is the command
      result.command = rest;
      break;
    }

    if (spaceIdx < 0) {
      rest = "";
    } else {
      rest = rest.slice(spaceIdx + 1).trimStart();
    }
  }

  if (!result.command) {
    throw new Error(`Line ${lineNum + 1}: Missing command in process definition`);
  }

  return result;
}

/**
 * Parse a Sandboxfile from a file path
 */
export async function parseSandboxfileFromPath(path: string): Promise<Sandboxfile> {
  const file = Bun.file(path);
  const content = await file.text();
  return parseSandboxfile(content);
}

/**
 * Create and run a sandbox from a Sandboxfile path
 */
export async function runSandbox(sandboxfilePath: string, options: SandboxOptions = {}): Promise<Sandbox> {
  const config = await parseSandboxfileFromPath(sandboxfilePath);
  const sandbox = new Sandbox(config, options);
  return sandbox;
}

/**
 * Infer a Sandboxfile from the current project
 */
export async function inferSandboxfile(cwd: string = process.cwd()): Promise<Sandboxfile> {
  const result: Sandboxfile = {
    from: "host",
    workdir: ".",
    runCommands: [],
    services: [],
    tests: [],
    outputs: [],
    logs: [],
    net: [],
    secrets: [],
  };

  // Check for package.json
  const packageJsonPath = `${cwd}/package.json`;
  const packageJsonFile = Bun.file(packageJsonPath);

  if (await packageJsonFile.exists()) {
    const packageJson = await packageJsonFile.json();

    // Add install command
    if (packageJson.dependencies || packageJson.devDependencies) {
      result.runCommands.push("bun install");
    }

    // Check for common scripts
    if (packageJson.scripts) {
      if (packageJson.scripts.dev) {
        result.dev = { command: "bun run dev" };
      }
      if (packageJson.scripts.start && !packageJson.scripts.dev) {
        result.dev = { command: "bun run start" };
      }
      if (packageJson.scripts.test) {
        result.tests.push({ command: "bun run test" });
      }
      if (packageJson.scripts.build) {
        result.runCommands.push("bun run build");
      }
    }

    // Output package.json and common source directories
    result.outputs.push("package.json");

    const srcDir = Bun.file(`${cwd}/src`);
    if (await srcDir.exists()) {
      result.outputs.push("src/");
    }

    const libDir = Bun.file(`${cwd}/lib`);
    if (await libDir.exists()) {
      result.outputs.push("lib/");
    }
  }

  // Check for bun.lockb
  if (await Bun.file(`${cwd}/bun.lockb`).exists()) {
    result.outputs.push("bun.lockb");
  }

  // Check for common log locations
  const logsDir = Bun.file(`${cwd}/logs`);
  if (await logsDir.exists()) {
    result.logs.push("logs/*");
  }

  // Check for .env file to infer secrets
  const envPath = `${cwd}/.env`;
  if (await Bun.file(envPath).exists()) {
    const envContent = await Bun.file(envPath).text();
    const secretPattern = /^([A-Z][A-Z0-9_]*(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_API_KEY))=/gm;
    let match;
    while ((match = secretPattern.exec(envContent)) !== null) {
      result.secrets.push(match[1]);
    }
  }

  return result;
}

// Default export
export default {
  Sandbox,
  parseSandboxfile,
  parseSandboxfileFromPath,
  runSandbox,
  inferSandboxfile,
};
