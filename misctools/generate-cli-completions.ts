#!/usr/bin/env bun
/**
 * CLI Flag Parser for Bun Commands
 *
 * This script reads the --help menu for every Bun command and generates JSON
 * containing all flag information, descriptions, and whether they support
 * positional or non-positional arguments.
 *
 * Handles complex cases like:
 * - Nested subcommands (bun pm cache rm)
 * - Command aliases (bun i = bun install, bun a = bun add)
 * - Dynamic completions (scripts, packages, files)
 * - Context-aware flags
 * - Special cases like bare 'bun' vs 'bun run'
 *
 * Output is saved to completions/bun-cli.json for use in generating
 * shell completions (fish, bash, zsh).
 */

import { spawn } from "bun";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";

interface FlagInfo {
  name: string;
  shortName?: string;
  description: string;
  hasValue: boolean;
  valueType?: string;
  defaultValue?: string;
  choices?: string[];
  required?: boolean;
  multiple?: boolean;
}

interface SubcommandInfo {
  name: string;
  description: string;
  flags?: FlagInfo[];
  subcommands?: Record<string, SubcommandInfo>;
  positionalArgs?: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[];
  examples?: string[];
}

interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  flags: FlagInfo[];
  positionalArgs: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[];
  examples: string[];
  subcommands?: Record<string, SubcommandInfo>;
  documentationUrl?: string;
  dynamicCompletions?: {
    scripts?: boolean;
    packages?: boolean;
    files?: boolean;
    binaries?: boolean;
  };
}

interface CompletionData {
  version: string;
  commands: Record<string, CommandInfo>;
  globalFlags: FlagInfo[];
  specialHandling: {
    bareCommand: {
      description: string;
      canRunFiles: boolean;
      dynamicCompletions: {
        scripts: boolean;
        files: boolean;
        binaries: boolean;
      };
    };
  };
  bunGetCompletes: {
    available: boolean;
    commands: {
      scripts: string; // "bun getcompletes s" or "bun getcompletes z"
      binaries: string; // "bun getcompletes b"
      packages: string; // "bun getcompletes a <prefix>"
      files: string; // "bun getcompletes j"
    };
  };
}

const BUN_EXECUTABLE = process.env.BUN_DEBUG_BUILD || "bun";

/**
 * Parse flag line from help output
 */
function parseFlag(line: string): FlagInfo | null {
  // Match patterns like:
  // -h, --help                          Display this menu and exit
  // --timeout=<val>              Set the per-test timeout in milliseconds, default is 5000.
  // -r, --preload=<val>                 Import a module before other modules are loaded
  // --watch                         Automatically restart the process on file change

  const patterns = [
    // Long flag with short flag and value: -r, --preload=<val>
    /^\s*(-[a-zA-Z]),\s+(--[a-zA-Z-]+)=(<[^>]+>)\s+(.+)$/,
    // Long flag with short flag: -h, --help
    /^\s*(-[a-zA-Z]),\s+(--[a-zA-Z-]+)\s+(.+)$/,
    // Long flag with value: --timeout=<val>
    /^\s+(--[a-zA-Z-]+)=(<[^>]+>)\s+(.+)$/,
    // Long flag without value: --watch
    /^\s+(--[a-zA-Z-]+)\s+(.+)$/,
    // Short flag only: -i
    /^\s+(-[a-zA-Z])\s+(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      let shortName: string | undefined;
      let longName: string;
      let valueSpec: string | undefined;
      let description: string;

      if (match.length === 5) {
        // Pattern with short flag, long flag, and value
        [, shortName, longName, valueSpec, description] = match;
      } else if (match.length === 4) {
        if (match[1].startsWith("-") && match[1].length === 2) {
          // Short flag with long flag
          [, shortName, longName, description] = match;
        } else if (match[2].startsWith("<")) {
          // Long flag with value
          [, longName, valueSpec, description] = match;
        } else {
          // Long flag without value
          [, longName, description] = match;
        }
      } else if (match.length === 3) {
        if (match[1].length === 2) {
          // Short flag only
          [, shortName, description] = match;
          longName = shortName.replace("-", "--");
        } else {
          // Long flag without value
          [, longName, description] = match;
        }
      } else {
        continue;
      }

      // Extract additional info from description
      const hasValue = !!valueSpec;
      let valueType: string | undefined;
      let defaultValue: string | undefined;
      let choices: string[] | undefined;

      if (valueSpec) {
        valueType = valueSpec.replace(/[<>]/g, "");
      }

      // Look for default values in description
      const defaultMatch = description.match(/[Dd]efault(?:s?)\s*(?:is|to|:)\s*"?([^".\s,]+)"?/);
      if (defaultMatch) {
        defaultValue = defaultMatch[1];
      }

      // Look for choices/enums
      const choicesMatch = description.match(/(?:One of|Valid (?:orders?|values?|options?)):?\s*"?([^"]+)"?/);
      if (choicesMatch) {
        choices = choicesMatch[1]
          .split(/[,\s]+/)
          .map(s => s.replace(/[",]/g, "").trim())
          .filter(Boolean);
      }

      return {
        name: longName.replace(/^--/, ""),
        shortName: shortName?.replace(/^-/, ""),
        description: description.trim(),
        hasValue,
        valueType,
        defaultValue,
        choices,
        required: false, // We'll determine this from usage patterns
        multiple: description.toLowerCase().includes("multiple") || description.includes("[]"),
      };
    }
  }

  return null;
}

/**
 * Parse usage line to extract positional arguments
 */
function parseUsage(usage: string): {
  name: string;
  description?: string;
  required: boolean;
  multiple: boolean;
  type?: string;
  completionType?: string;
}[] {
  const args: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
    completionType?: string;
  }[] = [];

  // Extract parts after command name
  const parts = usage.split(/\s+/).slice(2); // Skip "Usage:" and command name

  for (const part of parts) {
    if (part.startsWith("[") || part.startsWith("<") || part.includes("...")) {
      let name = part;
      let required = false;
      let multiple = false;
      let completionType: string | undefined;

      // Clean up the argument name
      name = name.replace(/[\[\]<>]/g, "");

      if (part.startsWith("<")) {
        required = true;
      }

      if (part.includes("...") || name.includes("...")) {
        multiple = true;
        name = name.replace(/\.{3}/g, "");
      }

      // Skip flags
      if (!name.startsWith("-") && name.length > 0) {
        // Determine completion type based on argument name
        if (name.toLowerCase().includes("package")) {
          completionType = "package";
        } else if (name.toLowerCase().includes("script")) {
          completionType = "script";
        } else if (name.toLowerCase().includes("file") || name.includes(".")) {
          completionType = "file";
        }

        args.push({
          name,
          required,
          multiple,
          type: "string", // Default type
          completionType,
        });
      }
    }
  }

  return args;
}

const temppackagejson = mkdtempSync("package");
writeFileSync(
  join(temppackagejson, "package.json"),
  JSON.stringify({
    name: "test",
    version: "1.0.0",
    scripts: {},
  }),
);
process.once("beforeExit", () => {
  rmSync(temppackagejson, { recursive: true });
});

/**
 * Execute bun command and get help output
 */
async function getHelpOutput(command: string[]): Promise<string> {
  try {
    const proc = spawn({
      cmd: [BUN_EXECUTABLE, ...command, "--help"],
      stdout: "pipe",
      stderr: "pipe",
      cwd: temppackagejson,
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    await proc.exited;

    return stdout || stderr || "";
  } catch (error) {
    console.error(`Failed to get help for command: ${command.join(" ")}`, error);
    return "";
  }
}

/**
 * Parse PM subcommands from help output
 */
function parsePmSubcommands(helpText: string): Record<string, SubcommandInfo> {
  const lines = helpText.split("\n");
  const subcommands: Record<string, SubcommandInfo> = {};

  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Commands:") {
      inCommands = true;
      continue;
    }

    if (inCommands && trimmed.startsWith("Learn more")) {
      break;
    }

    if (inCommands && line.match(/^\s+bun pm \w+/)) {
      // Parse lines like: "bun pm pack                 create a tarball of the current workspace"
      const match = line.match(/^\s+bun pm (\S+)(?:\s+(.+))?$/);
      if (match) {
        const [, name, description = ""] = match;
        subcommands[name] = {
          name,
          description: description.trim(),
          flags: [],
          positionalArgs: [],
        };

        // Special handling for subcommands with their own subcommands
        if (name === "cache") {
          subcommands[name].subcommands = {
            rm: {
              name: "rm",
              description: "clear the cache",
            },
          };
        } else if (name === "pkg") {
          subcommands[name].subcommands = {
            get: { name: "get", description: "get values from package.json" },
            set: { name: "set", description: "set values in package.json" },
            delete: { name: "delete", description: "delete keys from package.json" },
            fix: { name: "fix", description: "auto-correct common package.json errors" },
          };
        }
      }
    }
  }

  return subcommands;
}

/**
 * Parse help output into CommandInfo
 */
function parseHelpOutput(helpText: string, commandName: string): CommandInfo {
  const lines = helpText.split("\n");
  const command: CommandInfo = {
    name: commandName,
    description: "",
    flags: [],
    positionalArgs: [],
    examples: [],
  };

  let currentSection = "";
  let inFlags = false;
  let inExamples = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Extract command description (usually the first non-usage line)
    if (
      !command.description &&
      trimmed &&
      !trimmed.startsWith("Usage:") &&
      !trimmed.startsWith("Alias:") &&
      currentSection === ""
    ) {
      command.description = trimmed;
      continue;
    }

    // Extract aliases
    if (trimmed.startsWith("Alias:")) {
      const aliasMatch = trimmed.match(/Alias:\s*(.+)/);
      if (aliasMatch) {
        command.aliases = aliasMatch[1]
          .split(/[,\s]+/)
          .map(a => a.trim())
          .filter(Boolean);
      }
      continue;
    }

    // Extract usage and positional args
    if (trimmed.startsWith("Usage:")) {
      command.usage = trimmed;
      command.positionalArgs = parseUsage(trimmed);
      continue;
    }

    // Track sections
    if (trimmed === "Flags:") {
      inFlags = true;
      currentSection = "flags";
      continue;
    } else if (trimmed === "Examples:") {
      inExamples = true;
      inFlags = false;
      currentSection = "examples";
      continue;
    } else if (
      trimmed.startsWith("Full documentation") ||
      trimmed.startsWith("Learn more") ||
      trimmed.startsWith("A full list")
    ) {
      const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        command.documentationUrl = urlMatch[0];
      }
      inFlags = false;
      inExamples = false;
      continue;
    }

    // Parse flags
    if (inFlags && line.match(/^\s+(-|\s+--)/)) {
      const flag = parseFlag(line);
      if (flag) {
        command.flags.push(flag);
      }
    }

    // Parse examples
    if (inExamples && trimmed && !trimmed.startsWith("Full documentation")) {
      if (trimmed.startsWith("bun ") || trimmed.startsWith("./") || trimmed.startsWith("Bundle")) {
        command.examples.push(trimmed);
      }
    }
  }

  // Special case for pm command
  if (commandName === "pm") {
    command.subcommands = parsePmSubcommands(helpText);
  }

  // Add dynamic completion info based on command
  command.dynamicCompletions = {};
  if (commandName === "run") {
    command.dynamicCompletions.scripts = true;
    command.dynamicCompletions.files = true;
    command.dynamicCompletions.binaries = true;
    // Also add file type info for positional args
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("file") || arg.name.includes("script")) {
        arg.completionType = "javascript_files";
      }
    }
  } else if (commandName === "add") {
    command.dynamicCompletions.packages = true;
    // Mark package args
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("package") || arg.name === "name") {
        arg.completionType = "package";
      }
    }
  } else if (commandName === "remove") {
    command.dynamicCompletions.packages = true; // installed packages
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("package") || arg.name === "name") {
        arg.completionType = "installed_package";
      }
    }
  } else if (["test"].includes(commandName)) {
    command.dynamicCompletions.files = true;
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("pattern") || arg.name.includes("file")) {
        arg.completionType = "test_files";
      }
    }
  } else if (["build"].includes(commandName)) {
    command.dynamicCompletions.files = true;
    for (const arg of command.positionalArgs) {
      if (arg.name === "entrypoint" || arg.name.includes("file")) {
        arg.completionType = "javascript_files";
      }
    }
  } else if (commandName === "create") {
    // Create has special template completions
    for (const arg of command.positionalArgs) {
      if (arg.name.includes("template")) {
        arg.completionType = "create_template";
      }
    }
  }

  return command;
}

/**
 * Get list of main commands from bun --help
 */
async function getMainCommands(): Promise<string[]> {
  const helpText = await getHelpOutput([]);
  const lines = helpText.split("\n");
  const commands: string[] = [];

  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Commands:") {
      inCommands = true;
      continue;
    }

    // Stop when we hit the "Flags:" section
    if (inCommands && trimmed === "Flags:") {
      break;
    }

    if (inCommands && line.match(/^\s+\w+/)) {
      // Extract command name (first word after whitespace)
      const match = line.match(/^\s+(\w+)/);
      if (match) {
        commands.push(match[1]);
      }
    }
  }

  const commandsToRemove = ["lint"];

  return commands.filter(a => {
    if (commandsToRemove.includes(a)) {
      return false;
    }
    return true;
  });
}

/**
 * Extract global flags from main help
 */
function parseGlobalFlags(helpText: string): FlagInfo[] {
  const lines = helpText.split("\n");
  const flags: FlagInfo[] = [];

  let inFlags = false;
  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "Flags:") {
      inFlags = true;
      continue;
    }

    if (inFlags && (trimmed === "" || trimmed.startsWith("("))) {
      break;
    }

    if (inFlags && line.match(/^\s+(-|\s+--)/)) {
      const flag = parseFlag(line);
      if (flag) {
        flags.push(flag);
      }
    }
  }

  return flags;
}

/**
 * Add command aliases based on common patterns
 */
function addCommandAliases(commands: Record<string, CommandInfo>): void {
  const aliasMap: Record<string, string[]> = {
    "install": ["i"],
    "add": ["a"],
    "remove": ["rm"],
    "create": ["c"],
    "x": ["bunx"], // bunx is an alias for bun x
  };

  for (const [command, aliases] of Object.entries(aliasMap)) {
    if (commands[command]) {
      commands[command].aliases = aliases;
    }
  }
}

/**
 * Main function to generate completion data
 */
async function generateCompletions(): Promise<void> {
  console.log("🔍 Discovering Bun commands...");

  // Get main help and extract commands
  const mainHelpText = await getHelpOutput([]);
  const mainCommands = await getMainCommands();
  const globalFlags = parseGlobalFlags(mainHelpText);

  console.log(`📋 Found ${mainCommands.length} main commands: ${mainCommands.join(", ")}`);

  const completionData: CompletionData = {
    version: "1.1.0",
    commands: {},
    globalFlags,
    specialHandling: {
      bareCommand: {
        description: "Run JavaScript/TypeScript files directly or access package scripts and binaries",
        canRunFiles: true,
        dynamicCompletions: {
          scripts: true,
          files: true,
          binaries: true,
        },
      },
    },
    bunGetCompletes: {
      available: true,
      commands: {
        scripts: "bun getcompletes s", // or "bun getcompletes z" for scripts with descriptions
        binaries: "bun getcompletes b",
        packages: "bun getcompletes a", // takes prefix as argument
        files: "bun getcompletes j", // JavaScript/TypeScript files
      },
    },
  };

  // Parse each command
  for (const commandName of mainCommands) {
    console.log(`📖 Parsing help for: ${commandName}`);

    try {
      const helpText = await getHelpOutput([commandName]);
      if (helpText.trim()) {
        const commandInfo = parseHelpOutput(helpText, commandName);
        completionData.commands[commandName] = commandInfo;
      }
    } catch (error) {
      console.error(`❌ Failed to parse ${commandName}:`, error);
    }
  }

  // Add common aliases
  addCommandAliases(completionData.commands);

  // Also check some common subcommands that might have their own help
  const additionalCommands = ["pm"];
  for (const commandName of additionalCommands) {
    if (!completionData.commands[commandName]) {
      console.log(`📖 Parsing help for additional command: ${commandName}`);

      try {
        const helpText = await getHelpOutput([commandName]);
        if (helpText.trim() && !helpText.includes("error:") && !helpText.includes("Error:")) {
          const commandInfo = parseHelpOutput(helpText, commandName);
          completionData.commands[commandName] = commandInfo;
        }
      } catch (error) {
        console.error(`❌ Failed to parse ${commandName}:`, error);
      }
    }
  }

  // Ensure completions directory exists
  const completionsDir = join(process.cwd(), "completions");
  try {
    mkdirSync(completionsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  // Write the JSON file
  const outputPath = join(completionsDir, "bun-cli.json");
  const jsonData = JSON.stringify(completionData, null, 2);

  writeFileSync(outputPath, jsonData, "utf8");

  console.log(`✅ Generated CLI completion data at: ${outputPath}`);
  console.log(`📊 Statistics:`);
  console.log(`   - Commands: ${Object.keys(completionData.commands).length}`);
  console.log(`   - Global flags: ${completionData.globalFlags.length}`);

  let totalFlags = 0;
  let totalExamples = 0;
  let totalSubcommands = 0;
  for (const [name, cmd] of Object.entries(completionData.commands)) {
    totalFlags += cmd.flags.length;
    totalExamples += cmd.examples.length;
    const subcommandCount = cmd.subcommands ? Object.keys(cmd.subcommands).length : 0;
    totalSubcommands += subcommandCount;

    const aliasInfo = cmd.aliases ? ` (aliases: ${cmd.aliases.join(", ")})` : "";
    const subcommandInfo = subcommandCount > 0 ? `, ${subcommandCount} subcommands` : "";
    const dynamicInfo = cmd.dynamicCompletions ? ` [dynamic: ${Object.keys(cmd.dynamicCompletions).join(", ")}]` : "";

    console.log(
      `   - ${name}${aliasInfo}: ${cmd.flags.length} flags, ${cmd.positionalArgs.length} positional args, ${cmd.examples.length} examples${subcommandInfo}${dynamicInfo}`,
    );
  }

  console.log(`   - Total command flags: ${totalFlags}`);
  console.log(`   - Total examples: ${totalExamples}`);
  console.log(`   - Total subcommands: ${totalSubcommands}`);
}

// Run the script
if (import.meta.main) {
  generateCompletions().catch(console.error);
}
