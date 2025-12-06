#!/usr/bin/env bun
/**
 * Sandboxfile CLI
 *
 * Usage:
 *   bun sandbox [options] [Sandboxfile]
 *   bun sandbox run [options] [Sandboxfile]
 *   bun sandbox test [options] [Sandboxfile]
 *   bun sandbox validate [Sandboxfile]
 *   bun sandbox init
 */

import { loadSandboxfile } from "./parser";
import { SandboxRunner } from "./runner";

interface CliOptions {
  verbose: boolean;
  dryRun: boolean;
  file: string;
  cwd: string;
}

function printUsage(): void {
  console.log(`
Sandboxfile - Declarative agent sandbox configuration

Usage:
  bun sandbox [command] [options]

Commands:
  run       Run the sandbox (setup + services + dev)
  test      Run the sandbox and execute tests
  validate  Validate a Sandboxfile without running
  init      Create a new Sandboxfile in the current directory

Options:
  -f, --file <path>    Path to Sandboxfile (default: ./Sandboxfile)
  -C, --cwd <dir>      Working directory (default: current directory)
  -v, --verbose        Enable verbose output
  -n, --dry-run        Show what would be done without executing
  -h, --help           Show this help message

Examples:
  bun sandbox run                    # Run using ./Sandboxfile
  bun sandbox test -f sandbox.conf   # Run tests using custom file
  bun sandbox validate               # Validate ./Sandboxfile
  bun sandbox init                   # Create a new Sandboxfile
`);
}

function parseArgs(args: string[]): { command: string; options: CliOptions } {
  const options: CliOptions = {
    verbose: false,
    dryRun: false,
    file: "Sandboxfile",
    cwd: process.cwd(),
  };

  let command = "run"; // default command
  let i = 0;

  // First non-option argument is the command
  if (args.length > 0 && !args[0].startsWith("-")) {
    const cmd = args[0];
    if (["run", "test", "validate", "init", "help"].includes(cmd)) {
      command = cmd;
      i = 1;
    }
  }

  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      command = "help";
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "-n" || arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-f" || arg === "--file") {
      i++;
      if (i < args.length) {
        options.file = args[i];
      }
    } else if (arg === "-C" || arg === "--cwd") {
      i++;
      if (i < args.length) {
        options.cwd = args[i];
      }
    } else if (!arg.startsWith("-")) {
      // Positional argument - treat as file path
      options.file = arg;
    }

    i++;
  }

  return { command, options };
}

async function cmdRun(options: CliOptions): Promise<number> {
  console.log(`Loading Sandboxfile: ${options.file}`);

  const runner = await SandboxRunner.fromFile(options.file, {
    cwd: options.cwd,
    verbose: options.verbose,
    dryRun: options.dryRun,
    onLog: (source, message) => {
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      console.log(`\x1b[90m${timestamp}\x1b[0m [\x1b[36m${source}\x1b[0m] ${message}`);
    },
  });

  const config = runner.getConfig();
  console.log(`\nSandbox configuration:`);
  console.log(`  FROM: ${config.from || "host"}`);
  console.log(`  WORKDIR: ${config.workdir || "."}`);
  console.log(`  RUN commands: ${config.runCommands.length}`);
  console.log(`  Services: ${config.services.length}`);
  console.log(`  DEV server: ${config.dev ? "yes" : "no"}`);
  console.log(`  Tests: ${config.tests.length}`);
  console.log(`  Outputs: ${config.outputs.length}`);
  console.log(`  Network rules: ${config.netHosts.length}`);
  console.log(`  Secrets: ${config.secrets.length}`);
  console.log();

  // Run setup and start services
  const setupOk = await runner.runSetup();
  if (!setupOk) {
    console.error("\x1b[31mSetup failed\x1b[0m");
    return 1;
  }

  const servicesOk = await runner.startServices();
  if (!servicesOk) {
    console.error("\x1b[31mServices failed to start\x1b[0m");
    await runner.stopAll();
    return 1;
  }

  const devHandle = await runner.startDev();
  if (devHandle) {
    console.log(`\n\x1b[32mDev server running\x1b[0m`);
    if (devHandle.port) {
      console.log(`  URL: http://localhost:${devHandle.port}`);
    }
  }

  console.log("\n\x1b[32mSandbox is running.\x1b[0m Press Ctrl+C to stop.\n");

  // Wait for interrupt
  await new Promise<void>(resolve => {
    process.on("SIGINT", async () => {
      console.log("\n\x1b[33mShutting down...\x1b[0m");
      await runner.stopAll();
      resolve();
    });
  });

  return 0;
}

async function cmdTest(options: CliOptions): Promise<number> {
  console.log(`Loading Sandboxfile: ${options.file}`);

  const runner = await SandboxRunner.fromFile(options.file, {
    cwd: options.cwd,
    verbose: options.verbose,
    dryRun: options.dryRun,
    onLog: (source, message) => {
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
      console.log(`\x1b[90m${timestamp}\x1b[0m [\x1b[36m${source}\x1b[0m] ${message}`);
    },
  });

  const result = await runner.run();

  if (!result.success) {
    console.error("\n\x1b[31mSandbox execution failed\x1b[0m");
    return 1;
  }

  if (!result.testsPassed) {
    console.error("\n\x1b[31mTests failed\x1b[0m");
    return 1;
  }

  console.log("\n\x1b[32mAll tests passed!\x1b[0m");
  return 0;
}

async function cmdValidate(options: CliOptions): Promise<number> {
  console.log(`Validating Sandboxfile: ${options.file}`);

  try {
    const config = await loadSandboxfile(options.file);

    console.log("\n\x1b[32mSandboxfile is valid\x1b[0m\n");
    console.log("Configuration:");
    console.log(`  FROM: ${config.from || "(not set)"}`);
    console.log(`  WORKDIR: ${config.workdir || "(not set)"}`);
    console.log(`  RUN commands: ${config.runCommands.length}`);

    if (config.dev) {
      console.log(`  DEV: ${config.dev.name || "(unnamed)"}`);
      if (config.dev.port) console.log(`    PORT: ${config.dev.port}`);
      if (config.dev.watch) console.log(`    WATCH: ${config.dev.watch}`);
      console.log(`    COMMAND: ${config.dev.command}`);
    }

    for (const svc of config.services) {
      console.log(`  SERVICE: ${svc.name}`);
      if (svc.port) console.log(`    PORT: ${svc.port}`);
      if (svc.watch) console.log(`    WATCH: ${svc.watch}`);
      console.log(`    COMMAND: ${svc.command}`);
    }

    for (const test of config.tests) {
      console.log(`  TEST: ${test.name || "(unnamed)"}`);
      console.log(`    COMMAND: ${test.command}`);
    }

    console.log(`  OUTPUT patterns: ${config.outputs.join(", ") || "(none)"}`);
    console.log(`  LOG patterns: ${config.logs.join(", ") || "(none)"}`);
    console.log(`  NET hosts: ${config.netHosts.join(", ") || "(deny all)"}`);
    console.log(`  SECRETS: ${config.secrets.join(", ") || "(none)"}`);
    console.log(`  INFER patterns: ${config.inferPatterns.join(", ") || "(none)"}`);

    return 0;
  } catch (err) {
    console.error(`\n\x1b[31mError:\x1b[0m ${err}`);
    return 1;
  }
}

async function cmdInit(_options: CliOptions): Promise<number> {
  const defaultSandboxfile = `# Sandboxfile

FROM host
WORKDIR .

# Setup commands (run once)
RUN bun install

# Development server
DEV PORT=3000 bun run dev

# Background services
# SERVICE db PORT=5432 docker compose up postgres

# Test commands
TEST bun test

# Files to extract from sandbox
OUTPUT src/
OUTPUT package.json

# Allowed network hosts
NET registry.npmjs.org
NET api.github.com

# Secret environment variables (values from host env)
# SECRET API_KEY
`;

  const filePath = "Sandboxfile";

  // Check if file already exists
  const file = Bun.file(filePath);
  if (await file.exists()) {
    console.error(`\x1b[31mError:\x1b[0m Sandboxfile already exists`);
    return 1;
  }

  await Bun.write(filePath, defaultSandboxfile);
  console.log(`\x1b[32mCreated Sandboxfile\x1b[0m`);
  console.log("\nEdit the file to configure your sandbox, then run:");
  console.log("  bun sandbox run     # Start the sandbox");
  console.log("  bun sandbox test    # Run tests in the sandbox");

  return 0;
}

export async function main(args: string[]): Promise<number> {
  const { command, options } = parseArgs(args);

  switch (command) {
    case "help":
      printUsage();
      return 0;

    case "run":
      return cmdRun(options);

    case "test":
      return cmdTest(options);

    case "validate":
      return cmdValidate(options);

    case "init":
      return cmdInit(options);

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      return 1;
  }
}

// Run if executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const exitCode = await main(args);
  process.exit(exitCode);
}
