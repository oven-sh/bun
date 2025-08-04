#!/usr/bin/env bun
/**
 * CLI Flag Parser for Bun Commands
 * 
 * This script reads the --help menu for every Bun command and generates JSON
 * containing all flag information, descriptions, and whether they support
 * positional or non-positional arguments.
 * 
 * Output is saved to completions/bun-cli.json for use in generating
 * shell completions (fish, bash, zsh).
 */

import { spawn } from "bun";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";

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

interface CommandInfo {
  name: string;
  alias?: string;
  description: string;
  usage?: string;
  flags: FlagInfo[];
  positionalArgs: {
    name: string;
    description?: string;
    required: boolean;
    multiple: boolean;
    type?: string;
  }[];
  examples: string[];
  subcommands?: string[];
  documentationUrl?: string;
}

interface CompletionData {
  version: string;
  commands: Record<string, CommandInfo>;
  globalFlags: FlagInfo[];
}

const BUN_EXECUTABLE = process.env.BUN_DEBUG_BUILD || "/workspace/bun/build/debug/bun-debug";

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
        if (match[1].startsWith('-') && match[1].length === 2) {
          // Short flag with long flag
          [, shortName, longName, description] = match;
        } else if (match[2].startsWith('<')) {
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
          longName = shortName.replace('-', '--');
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
        valueType = valueSpec.replace(/[<>]/g, '');
      }

      // Look for default values in description
      const defaultMatch = description.match(/[Dd]efault(?:s?)\s*(?:is|to|:)\s*"?([^".\s]+)"?/);
      if (defaultMatch) {
        defaultValue = defaultMatch[1];
      }

      // Look for choices/enums
      const choicesMatch = description.match(/(?:One of|Valid (?:orders?|values?)):?\s*"?([^"]+)"?/);
      if (choicesMatch) {
        choices = choicesMatch[1].split(/[,\s]+/).map(s => s.replace(/[",]/g, '').trim()).filter(Boolean);
      }

      return {
        name: longName.replace(/^--/, ''),
        shortName: shortName?.replace(/^-/, ''),
        description: description.trim(),
        hasValue,
        valueType,
        defaultValue,
        choices,
        required: false, // We'll determine this from usage patterns
        multiple: description.toLowerCase().includes('multiple') || description.includes('[]')
      };
    }
  }

  return null;
}

/**
 * Parse usage line to extract positional arguments
 */
function parseUsage(usage: string): { name: string; description?: string; required: boolean; multiple: boolean; type?: string; }[] {
  const args: { name: string; description?: string; required: boolean; multiple: boolean; type?: string; }[] = [];
  
  // Extract parts after command name
  const parts = usage.split(/\s+/).slice(2); // Skip "Usage:" and command name
  
  for (const part of parts) {
    if (part.startsWith('[') || part.startsWith('<') || part.includes('...')) {
      let name = part;
      let required = false;
      let multiple = false;
      
      // Clean up the argument name
      name = name.replace(/[\[\]<>]/g, '');
      
      if (part.startsWith('<')) {
        required = true;
      }
      
      if (part.includes('...') || name.includes('...')) {
        multiple = true;
        name = name.replace(/\.{3}/g, '');
      }
      
      // Skip flags
      if (!name.startsWith('-') && name.length > 0) {
        args.push({
          name,
          required,
          multiple,
          type: 'string' // Default type
        });
      }
    }
  }
  
  return args;
}

/**
 * Execute bun command and get help output
 */
async function getHelpOutput(command: string[]): Promise<string> {
  try {
    const proc = spawn({
      cmd: [BUN_EXECUTABLE, ...command, "--help"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    await proc.exited;
    
    return stdout || stderr || "";
  } catch (error) {
    console.error(`Failed to get help for command: ${command.join(' ')}`, error);
    return "";
  }
}

/**
 * Parse help output into CommandInfo
 */
function parseHelpOutput(helpText: string, commandName: string): CommandInfo {
  const lines = helpText.split('\n');
  const command: CommandInfo = {
    name: commandName,
    description: "",
    flags: [],
    positionalArgs: [],
    examples: []
  };

  let currentSection = '';
  let inFlags = false;
  let inExamples = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Extract command description (usually the first non-usage line)
    if (!command.description && trimmed && !trimmed.startsWith('Usage:') && !trimmed.startsWith('Alias:') && currentSection === '') {
      command.description = trimmed;
      continue;
    }

    // Extract alias
    if (trimmed.startsWith('Alias:')) {
      const aliasMatch = trimmed.match(/Alias:\s*(.+)/);
      if (aliasMatch) {
        command.alias = aliasMatch[1].trim();
      }
      continue;
    }

    // Extract usage and positional args
    if (trimmed.startsWith('Usage:')) {
      command.usage = trimmed;
      command.positionalArgs = parseUsage(trimmed);
      continue;
    }

    // Track sections
    if (trimmed === 'Flags:') {
      inFlags = true;
      currentSection = 'flags';
      continue;
    } else if (trimmed === 'Examples:') {
      inExamples = true;
      inFlags = false;
      currentSection = 'examples';
      continue;
    } else if (trimmed.startsWith('Full documentation') || trimmed.startsWith('Learn more') || trimmed.startsWith('A full list')) {
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
    if (inExamples && trimmed && !trimmed.startsWith('Full documentation')) {
      if (trimmed.startsWith('bun ') || trimmed.startsWith('./') || trimmed.startsWith('Bundle')) {
        command.examples.push(trimmed);
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
  const lines = helpText.split('\n');
  const commands: string[] = [];

  let inCommands = false;
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === 'Commands:') {
      inCommands = true;
      continue;
    }
    
    // Stop when we hit the "Flags:" section
    if (inCommands && trimmed === 'Flags:') {
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

  return commands;
}

/**
 * Extract global flags from main help
 */
function parseGlobalFlags(helpText: string): FlagInfo[] {
  const lines = helpText.split('\n');
  const flags: FlagInfo[] = [];
  
  let inFlags = false;
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed === 'Flags:') {
      inFlags = true;
      continue;
    }
    
    if (inFlags && (trimmed === '' || trimmed.startsWith('('))) {
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
 * Main function to generate completion data
 */
async function generateCompletions(): Promise<void> {
  console.log("🔍 Discovering Bun commands...");
  
  // Get main help and extract commands
  const mainHelpText = await getHelpOutput([]);
  const mainCommands = await getMainCommands();
  const globalFlags = parseGlobalFlags(mainHelpText);
  
  console.log(`📋 Found ${mainCommands.length} main commands: ${mainCommands.join(', ')}`);
  
  const completionData: CompletionData = {
    version: "1.0.0",
    commands: {},
    globalFlags
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

  // Also check some common subcommands that might have their own help
  const additionalCommands = ['pm', 'x'];
  for (const commandName of additionalCommands) {
    if (!completionData.commands[commandName]) {
      console.log(`📖 Parsing help for additional command: ${commandName}`);
      
      try {
        const helpText = await getHelpOutput([commandName]);
        if (helpText.trim() && !helpText.includes('error:') && !helpText.includes('Error:')) {
          const commandInfo = parseHelpOutput(helpText, commandName);
          completionData.commands[commandName] = commandInfo;
        }
      } catch (error) {
        console.error(`❌ Failed to parse ${commandName}:`, error);
      }
    }
  }

  // Ensure completions directory exists
  const completionsDir = join(process.cwd(), 'completions');
  try {
    mkdirSync(completionsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  // Write the JSON file
  const outputPath = join(completionsDir, 'bun-cli.json');
  const jsonData = JSON.stringify(completionData, null, 2);
  
  writeFileSync(outputPath, jsonData, 'utf8');
  
  console.log(`✅ Generated CLI completion data at: ${outputPath}`);
  console.log(`📊 Statistics:`);
  console.log(`   - Commands: ${Object.keys(completionData.commands).length}`);
  console.log(`   - Global flags: ${completionData.globalFlags.length}`);
  
  let totalFlags = 0;
  let totalExamples = 0;
  for (const [name, cmd] of Object.entries(completionData.commands)) {
    totalFlags += cmd.flags.length;
    totalExamples += cmd.examples.length;
    console.log(`   - ${name}: ${cmd.flags.length} flags, ${cmd.positionalArgs.length} positional args, ${cmd.examples.length} examples`);
  }
  
  console.log(`   - Total command flags: ${totalFlags}`);
  console.log(`   - Total examples: ${totalExamples}`);
}

// Run the script
if (import.meta.main) {
  generateCompletions().catch(console.error);
}