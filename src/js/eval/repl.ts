// Built-in REPL implementation for `bun repl`
// This replaces the external bun-repl package for faster startup

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import util from "node:util";
import { runInThisContext } from "node:vm";

// REPL state
let lastResult: any = undefined;
let lastError: any = undefined;
let lineBuffer = "";
let inMultilineInput = false;

// ANSI color codes
const useColors = Boolean(process.stdout.isTTY && !("NO_COLOR" in process.env));
const colors = {
  reset: useColors ? "\x1b[0m" : "",
  cyan: useColors ? "\x1b[36m" : "",
  yellow: useColors ? "\x1b[33m" : "",
  red: useColors ? "\x1b[31m" : "",
  green: useColors ? "\x1b[32m" : "",
  dim: useColors ? "\x1b[2m" : "",
};

function colorize(text: string, color: string): string {
  return color ? `${color}${text}${colors.reset}` : text;
}

// History file path - handle edge case where homedir() returns empty string
const homeDir = os.homedir();
const historyPath = homeDir ? path.join(homeDir, ".bun_repl_history") : "";
const maxHistorySize = 1000;

// Debounce timer for history saves
let historySaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingHistory: string[] | null = null;

function loadHistory(): string[] {
  if (!historyPath) return [];
  try {
    if (fs.existsSync(historyPath)) {
      const content = fs.readFileSync(historyPath, "utf-8");
      return content.split("\n").filter((line: string) => line.trim());
    }
  } catch {
    // Ignore errors loading history
  }
  return [];
}

function saveHistoryImmediate(history: string[]): void {
  if (!historyPath) return;
  try {
    const toSave = history.slice(-maxHistorySize);
    fs.writeFileSync(historyPath, toSave.join("\n") + "\n");
  } catch {
    // Ignore errors saving history
  }
}

function saveHistory(history: string[]): void {
  // Debounce history writes - save after 1 second of inactivity
  pendingHistory = history;
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
  }
  historySaveTimer = setTimeout(() => {
    if (pendingHistory) {
      saveHistoryImmediate(pendingHistory);
      pendingHistory = null;
    }
    historySaveTimer = null;
  }, 1000);
}

function flushHistory(): void {
  // Flush any pending history writes immediately
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer = null;
  }
  if (pendingHistory) {
    saveHistoryImmediate(pendingHistory);
    pendingHistory = null;
  }
}

// Check if code is incomplete (e.g., unclosed brackets)
function isIncompleteCode(code: string): boolean {
  // Simple bracket counting approach
  let braceCount = 0;
  let bracketCount = 0;
  let parenCount = 0;
  let inString: string | null = null;
  let inTemplate = false;
  let escaped = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    // Handle strings
    if (!inString && !inTemplate) {
      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }
      if (char === "`") {
        inTemplate = true;
        continue;
      }
    } else if (inString && char === inString) {
      inString = null;
      continue;
    } else if (inTemplate && char === "`") {
      inTemplate = false;
      continue;
    }

    // Skip content inside strings
    if (inString || inTemplate) continue;

    // Count brackets
    switch (char) {
      case "{":
        braceCount++;
        break;
      case "}":
        braceCount--;
        break;
      case "[":
        bracketCount++;
        break;
      case "]":
        bracketCount--;
        break;
      case "(":
        parenCount++;
        break;
      case ")":
        parenCount--;
        break;
    }
  }

  // Incomplete if any unclosed delimiters or unclosed strings
  return inString !== null || inTemplate || braceCount > 0 || bracketCount > 0 || parenCount > 0;
}

// REPL commands
const replCommands: Record<string, { help: string; action: (args: string) => void }> = {
  ".help": {
    help: "Print this help message",
    action: () => {
      console.log("REPL Commands:");
      for (const [cmd, { help }] of Object.entries(replCommands)) {
        console.log(`  ${cmd.padEnd(12)} ${help}`);
      }
    },
  },
  ".exit": {
    help: "Exit the REPL",
    action: () => {
      process.exit(0);
    },
  },
  ".clear": {
    help: "Clear the REPL context",
    action: () => {
      lastResult = undefined;
      lastError = undefined;
      console.log("REPL context cleared");
    },
  },
  ".load": {
    help: "Load a file into the REPL session",
    action: (filename: string) => {
      if (!filename.trim()) {
        console.log(colorize("Usage: .load <filename>", colors.red));
        return;
      }
      try {
        const code = fs.readFileSync(filename.trim(), "utf-8");
        const result = evaluateCode(code);
        if (result !== undefined) {
          console.log(formatResult(result));
        }
      } catch (err: any) {
        console.log(colorize(`Error loading file: ${err.message}`, colors.red));
      }
    },
  },
};

// Evaluate code in the global context
function evaluateCode(code: string): any {
  // Handle special _ and _error variables
  (globalThis as any)._ = lastResult;
  (globalThis as any)._error = lastError;

  try {
    // Use runInThisContext for proper JavaScript evaluation
    const result = runInThisContext(code, {
      filename: "repl",
      displayErrors: true,
    });
    lastResult = result;
    return result;
  } catch (err: any) {
    lastError = err;
    throw err;
  }
}

// Format the result for display
function formatResult(result: any): string {
  if (result === undefined) {
    return colorize("undefined", colors.dim);
  }
  return util.inspect(result, {
    colors: useColors,
    depth: 4,
    maxArrayLength: 100,
    maxStringLength: 10000,
    breakLength: process.stdout.columns || 80,
  });
}

// Get the prompt string
function getPrompt(): string {
  if (inMultilineInput) {
    return colorize("... ", colors.dim);
  }
  return colorize("bun", colors.green) + colorize("> ", colors.reset);
}

// Simple tab completer
function completer(line: string): [string[], string] {
  const completions: string[] = [];
  const trimmed = line.trim();

  // Complete REPL commands
  if (trimmed.startsWith(".")) {
    const matches = Object.keys(replCommands).filter(cmd => cmd.startsWith(trimmed));
    return [matches, trimmed];
  }

  // Try to complete global properties
  try {
    // Find the last word being typed
    const match = line.match(/[\w$]+$/);
    if (match) {
      const prefix = match[0];
      const props = Object.getOwnPropertyNames(globalThis).filter(p => p.startsWith(prefix));
      return [props, prefix];
    }
  } catch {
    // Ignore completion errors
  }

  return [completions, line];
}

// Handle a line of input
function handleLine(line: string, rl: any, history: string[]): void {
  const trimmedLine = line.trim();

  // Handle empty line
  if (!trimmedLine && !inMultilineInput) {
    rl.prompt();
    return;
  }

  // Handle REPL commands
  if (trimmedLine.startsWith(".") && !inMultilineInput) {
    const spaceIndex = trimmedLine.indexOf(" ");
    const cmd = spaceIndex > 0 ? trimmedLine.slice(0, spaceIndex) : trimmedLine;
    const args = spaceIndex > 0 ? trimmedLine.slice(spaceIndex + 1) : "";

    if (replCommands[cmd]) {
      replCommands[cmd].action(args);
      rl.prompt();
      return;
    }
  }

  // Accumulate input
  lineBuffer += (lineBuffer ? "\n" : "") + line;

  // Check if code is complete
  if (isIncompleteCode(lineBuffer)) {
    inMultilineInput = true;
    rl.setPrompt(getPrompt());
    rl.prompt();
    return;
  }

  const code = lineBuffer;
  lineBuffer = "";
  inMultilineInput = false;

  // Add to history
  if (code.trim()) {
    history.push(code);
    saveHistory(history);
  }

  // Evaluate the code
  try {
    const result = evaluateCode(code);
    if (result !== undefined) {
      console.log(formatResult(result));
    }
  } catch (err: any) {
    // Format error message
    if (err.name === "SyntaxError") {
      console.log(colorize(`SyntaxError: ${err.message}`, colors.red));
    } else {
      console.log(colorize(`${err.name || "Error"}: ${err.message}`, colors.red));
      if (err.stack && process.env.BUN_DEBUG) {
        console.log(colorize(err.stack, colors.dim));
      }
    }
  }

  rl.setPrompt(getPrompt());
  rl.prompt();
}

// Main REPL function
function startRepl(): void {
  // Print welcome message
  console.log(`Welcome to Bun v${Bun.version}`);
  console.log('Type ".help" for more information.');

  const history = loadHistory();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPrompt(),
    terminal: process.stdin.isTTY,
    historySize: maxHistorySize,
    completer: process.stdin.isTTY ? completer : undefined,
    history: history.slice(-maxHistorySize),
  });

  rl.on("line", (line: string) => {
    handleLine(line, rl, history);
  });

  rl.on("close", () => {
    flushHistory();
    console.log();
    process.exit(0);
  });

  rl.on("SIGINT", () => {
    if (inMultilineInput) {
      // Cancel multiline input
      lineBuffer = "";
      inMultilineInput = false;
      console.log();
      rl.setPrompt(getPrompt());
      rl.prompt();
    } else {
      console.log("\n(To exit, press Ctrl+D or type .exit)");
      rl.prompt();
    }
  });

  rl.prompt();
}

// Start the REPL
startRepl();
