#!/usr/bin/env bun
/**
 * Sandbox CLI
 *
 * Run agent sandboxes from Sandboxfile declarations.
 *
 * Usage:
 *   bun-sandbox [options] [sandboxfile]
 *   bun-sandbox run [sandboxfile]      - Run the full sandbox lifecycle
 *   bun-sandbox test [sandboxfile]     - Run only tests
 *   bun-sandbox infer [dir]            - Infer a Sandboxfile from a project
 *   bun-sandbox validate [sandboxfile] - Validate a Sandboxfile
 */

import { inferSandboxfile, parseSandboxfileFromPath, Sandbox, type Sandboxfile, type SandboxOptions } from "./index";

const HELP = `
Sandbox CLI - Run agent sandboxes from Sandboxfile declarations

Usage:
  bun-sandbox [options] [sandboxfile]
  bun-sandbox run [sandboxfile]       Run the full sandbox lifecycle
  bun-sandbox test [sandboxfile]      Run only tests
  bun-sandbox infer [dir]             Infer a Sandboxfile from a project
  bun-sandbox validate [sandboxfile]  Validate a Sandboxfile
  bun-sandbox extract [sandboxfile]   Extract outputs to a directory

Options:
  -h, --help          Show this help message
  -v, --verbose       Enable verbose logging
  -w, --watch         Watch for changes and restart
  -o, --output <dir>  Output directory for extracted files
  -e, --env <KEY=VAL> Set environment variable
  --no-color          Disable colored output

Examples:
  bun-sandbox                          Run sandbox from ./Sandboxfile
  bun-sandbox run ./my-sandbox         Run sandbox from custom path
  bun-sandbox test                     Run only tests from ./Sandboxfile
  bun-sandbox infer                    Generate Sandboxfile from current project
  bun-sandbox validate ./Sandboxfile   Check if Sandboxfile is valid
`;

interface CLIOptions {
  command: "run" | "test" | "infer" | "validate" | "extract" | "help";
  sandboxfile: string;
  verbose: boolean;
  watch: boolean;
  outputDir?: string;
  env: Record<string, string>;
  noColor: boolean;
}

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    command: "run",
    sandboxfile: "Sandboxfile",
    verbose: false,
    watch: false,
    env: {},
    noColor: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "-h" || arg === "--help") {
      options.command = "help";
      return options;
    } else if (arg === "-v" || arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "-w" || arg === "--watch") {
      options.watch = true;
    } else if (arg === "-o" || arg === "--output") {
      options.outputDir = args[++i];
    } else if (arg === "-e" || arg === "--env") {
      const envArg = args[++i];
      const eqIdx = envArg.indexOf("=");
      if (eqIdx > 0) {
        options.env[envArg.slice(0, eqIdx)] = envArg.slice(eqIdx + 1);
      }
    } else if (arg === "--no-color") {
      options.noColor = true;
    } else if (arg === "run" || arg === "test" || arg === "infer" || arg === "validate" || arg === "extract") {
      options.command = arg;
    } else if (!arg.startsWith("-")) {
      options.sandboxfile = arg;
    }

    i++;
  }

  return options;
}

// Color helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function color(text: string, c: keyof typeof colors, noColor: boolean): string {
  if (noColor) return text;
  return `${colors[c]}${text}${colors.reset}`;
}

async function runCommand(options: CLIOptions): Promise<number> {
  const { noColor } = options;

  console.log(color("Sandbox", "cyan", noColor), color("v0.1.0", "dim", noColor));
  console.log();

  // Check if Sandboxfile exists
  const sandboxfilePath = options.sandboxfile;
  const file = Bun.file(sandboxfilePath);

  if (!(await file.exists())) {
    console.error(color(`Error: Sandboxfile not found: ${sandboxfilePath}`, "red", noColor));
    return 1;
  }

  // Parse Sandboxfile
  let config: Sandboxfile;
  try {
    config = await parseSandboxfileFromPath(sandboxfilePath);
  } catch (err) {
    console.error(color(`Error parsing Sandboxfile: ${err}`, "red", noColor));
    return 1;
  }

  console.log(color(`Loaded: ${sandboxfilePath}`, "dim", noColor));
  console.log(color(`FROM: ${config.from || "host"}`, "dim", noColor));
  console.log(color(`WORKDIR: ${config.workdir || "."}`, "dim", noColor));
  console.log();

  // Create sandbox
  const sandboxOptions: SandboxOptions = {
    verbose: options.verbose,
    env: options.env,
    onStdout: (service, data) => {
      const prefix = color(`[${service}]`, "cyan", noColor);
      process.stdout.write(`${prefix} ${data}`);
    },
    onStderr: (service, data) => {
      const prefix = color(`[${service}]`, "yellow", noColor);
      process.stderr.write(`${prefix} ${data}`);
    },
    onExit: (service, code) => {
      const status = code === 0 ? color("exited", "green", noColor) : color(`exited(${code})`, "red", noColor);
      console.log(color(`[${service}]`, "cyan", noColor), status);
    },
  };

  const sandbox = new Sandbox(config, sandboxOptions);

  // Handle SIGINT/SIGTERM
  const cleanup = async () => {
    console.log();
    console.log(color("Shutting down...", "yellow", noColor));
    await sandbox.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Run the sandbox
  console.log(color("Starting sandbox...", "bold", noColor));
  console.log();

  const result = await sandbox.run();

  if (result.testResults) {
    console.log();
    console.log(color("Test Results:", "bold", noColor));
    for (const test of result.testResults.results) {
      const status = test.passed ? color("PASS", "green", noColor) : color("FAIL", "red", noColor);
      console.log(`  ${status} ${test.name}`);
    }
    console.log();
  }

  // If services are still running, wait for them
  if (sandbox.isRunning()) {
    console.log(color("Services running. Press Ctrl+C to stop.", "dim", noColor));

    // Keep the process alive
    await new Promise(() => {});
  }

  // Extract outputs if requested
  if (options.outputDir) {
    console.log(color(`Extracting outputs to ${options.outputDir}...`, "dim", noColor));
    const extracted = await sandbox.extractOutputs(options.outputDir);
    console.log(color(`Extracted ${extracted.length} files`, "green", noColor));
  }

  return result.success ? 0 : 1;
}

async function testCommand(options: CLIOptions): Promise<number> {
  const { noColor } = options;

  console.log(color("Sandbox Test", "cyan", noColor));
  console.log();

  // Check if Sandboxfile exists
  const sandboxfilePath = options.sandboxfile;
  const file = Bun.file(sandboxfilePath);

  if (!(await file.exists())) {
    console.error(color(`Error: Sandboxfile not found: ${sandboxfilePath}`, "red", noColor));
    return 1;
  }

  // Parse Sandboxfile
  let config: Sandboxfile;
  try {
    config = await parseSandboxfileFromPath(sandboxfilePath);
  } catch (err) {
    console.error(color(`Error parsing Sandboxfile: ${err}`, "red", noColor));
    return 1;
  }

  if (config.tests.length === 0) {
    console.log(color("No tests defined in Sandboxfile", "yellow", noColor));
    return 0;
  }

  // Create sandbox
  const sandboxOptions: SandboxOptions = {
    verbose: options.verbose,
    env: options.env,
    onStdout: (service, data) => {
      const prefix = color(`[${service}]`, "cyan", noColor);
      process.stdout.write(`${prefix} ${data}`);
    },
    onStderr: (service, data) => {
      const prefix = color(`[${service}]`, "yellow", noColor);
      process.stderr.write(`${prefix} ${data}`);
    },
  };

  const sandbox = new Sandbox(config, sandboxOptions);

  // Run setup first
  console.log(color("Running setup...", "dim", noColor));
  const setupSuccess = await sandbox.runSetup();
  if (!setupSuccess) {
    console.error(color("Setup failed", "red", noColor));
    return 1;
  }

  // Start services if needed
  if (config.services.length > 0) {
    console.log(color("Starting services...", "dim", noColor));
    await sandbox.startServices();
    // Wait for services to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Run tests
  console.log(color("Running tests...", "bold", noColor));
  console.log();

  const testResults = await sandbox.runTests();

  // Stop services
  await sandbox.stop();

  // Print results
  console.log();
  console.log(color("Results:", "bold", noColor));
  for (const test of testResults.results) {
    const status = test.passed ? color("PASS", "green", noColor) : color("FAIL", "red", noColor);
    console.log(`  ${status} ${test.name}`);
  }

  console.log();
  const summary = testResults.passed
    ? color(`All ${testResults.results.length} tests passed`, "green", noColor)
    : color(
        `${testResults.results.filter(t => !t.passed).length} of ${testResults.results.length} tests failed`,
        "red",
        noColor,
      );
  console.log(summary);

  return testResults.passed ? 0 : 1;
}

async function inferCommand(options: CLIOptions): Promise<number> {
  const { noColor } = options;

  console.log(color("Inferring Sandboxfile...", "cyan", noColor));
  console.log();

  const dir = options.sandboxfile !== "Sandboxfile" ? options.sandboxfile : process.cwd();
  const config = await inferSandboxfile(dir);

  // Generate Sandboxfile content
  let output = "# Sandboxfile (auto-generated)\n\n";

  if (config.from) output += `FROM ${config.from}\n`;
  if (config.workdir) output += `WORKDIR ${config.workdir}\n`;
  output += "\n";

  for (const cmd of config.runCommands) {
    output += `RUN ${cmd}\n`;
  }
  if (config.runCommands.length > 0) output += "\n";

  if (config.dev) {
    output += `DEV ${config.dev.command}\n`;
  }

  for (const service of config.services) {
    output += `SERVICE ${service.name}`;
    if (service.port) output += ` PORT=${service.port}`;
    if (service.watch) output += ` WATCH=${service.watch}`;
    output += ` ${service.command}\n`;
  }
  if (config.services.length > 0 || config.dev) output += "\n";

  for (const test of config.tests) {
    output += `TEST ${test.command}\n`;
  }
  if (config.tests.length > 0) output += "\n";

  for (const out of config.outputs) {
    output += `OUTPUT ${out}\n`;
  }
  if (config.outputs.length > 0) output += "\n";

  for (const log of config.logs) {
    output += `LOGS ${log}\n`;
  }
  if (config.logs.length > 0) output += "\n";

  for (const net of config.net) {
    output += `NET ${net}\n`;
  }
  if (config.net.length > 0) output += "\n";

  for (const secret of config.secrets) {
    output += `SECRET ${secret}\n`;
  }

  console.log(output);

  // Optionally write to file
  if (options.outputDir) {
    const outPath = `${options.outputDir}/Sandboxfile`;
    await Bun.write(outPath, output);
    console.log(color(`Written to: ${outPath}`, "green", noColor));
  }

  return 0;
}

async function validateCommand(options: CLIOptions): Promise<number> {
  const { noColor } = options;

  console.log(color("Validating Sandboxfile...", "cyan", noColor));

  const sandboxfilePath = options.sandboxfile;
  const file = Bun.file(sandboxfilePath);

  if (!(await file.exists())) {
    console.error(color(`Error: Sandboxfile not found: ${sandboxfilePath}`, "red", noColor));
    return 1;
  }

  try {
    const config = await parseSandboxfileFromPath(sandboxfilePath);

    // Basic validation
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!config.from) {
      warnings.push("No FROM directive (defaulting to 'host')");
    }

    if (!config.workdir) {
      warnings.push("No WORKDIR directive (defaulting to '.')");
    }

    if (config.runCommands.length === 0 && config.services.length === 0 && !config.dev && config.tests.length === 0) {
      warnings.push("No commands defined (RUN, DEV, SERVICE, or TEST)");
    }

    if (config.outputs.length === 0) {
      warnings.push("No OUTPUT paths defined (all changes will be ephemeral)");
    }

    if (config.net.length === 0) {
      warnings.push("No NET hosts defined (network access will be denied)");
    }

    // Print results
    console.log();

    if (errors.length > 0) {
      console.log(color("Errors:", "red", noColor));
      for (const err of errors) {
        console.log(`  ${color("x", "red", noColor)} ${err}`);
      }
      console.log();
    }

    if (warnings.length > 0) {
      console.log(color("Warnings:", "yellow", noColor));
      for (const warn of warnings) {
        console.log(`  ${color("!", "yellow", noColor)} ${warn}`);
      }
      console.log();
    }

    // Print summary
    console.log(color("Summary:", "bold", noColor));
    console.log(`  FROM: ${config.from || "host"}`);
    console.log(`  WORKDIR: ${config.workdir || "."}`);
    console.log(`  RUN commands: ${config.runCommands.length}`);
    console.log(`  Services: ${config.services.length}`);
    console.log(`  Tests: ${config.tests.length}`);
    console.log(`  Outputs: ${config.outputs.length}`);
    console.log(`  Network hosts: ${config.net.length}`);
    console.log(`  Secrets: ${config.secrets.length}`);
    console.log();

    if (errors.length === 0) {
      console.log(color("Sandboxfile is valid", "green", noColor));
      return 0;
    } else {
      console.log(color("Sandboxfile has errors", "red", noColor));
      return 1;
    }
  } catch (err) {
    console.error(color(`Error: ${err}`, "red", noColor));
    return 1;
  }
}

async function extractCommand(options: CLIOptions): Promise<number> {
  const { noColor } = options;

  if (!options.outputDir) {
    console.error(color("Error: --output directory required for extract command", "red", noColor));
    return 1;
  }

  console.log(color("Extracting outputs...", "cyan", noColor));

  const sandboxfilePath = options.sandboxfile;
  const file = Bun.file(sandboxfilePath);

  if (!(await file.exists())) {
    console.error(color(`Error: Sandboxfile not found: ${sandboxfilePath}`, "red", noColor));
    return 1;
  }

  try {
    const config = await parseSandboxfileFromPath(sandboxfilePath);
    const sandbox = new Sandbox(config, { verbose: options.verbose });

    const extracted = await sandbox.extractOutputs(options.outputDir);

    console.log();
    console.log(color(`Extracted ${extracted.length} files:`, "green", noColor));
    for (const f of extracted) {
      console.log(`  ${f}`);
    }

    return 0;
  } catch (err) {
    console.error(color(`Error: ${err}`, "red", noColor));
    return 1;
  }
}

// Main entry point
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  switch (options.command) {
    case "help":
      console.log(HELP);
      return 0;
    case "run":
      return runCommand(options);
    case "test":
      return testCommand(options);
    case "infer":
      return inferCommand(options);
    case "validate":
      return validateCommand(options);
    case "extract":
      return extractCommand(options);
    default:
      console.log(HELP);
      return 1;
  }
}

// Run if executed directly
const exitCode = await main();
process.exit(exitCode);
