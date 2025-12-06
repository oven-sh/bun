/**
 * Sandboxfile Parser
 *
 * Parses Sandboxfile format for agent sandbox configuration.
 */

/**
 * Represents a process (DEV, SERVICE, or TEST)
 */
export interface SandboxProcess {
  /** Process name (required for SERVICE, optional for DEV/TEST) */
  name?: string;
  /** Port number if specified */
  port?: number;
  /** File watch patterns */
  watch?: string;
  /** Command to execute */
  command: string;
}

/**
 * Represents a parsed Sandboxfile
 */
export interface Sandboxfile {
  /** Base environment (e.g., "host" or a container image) */
  from?: string;
  /** Project root directory */
  workdir?: string;
  /** Setup commands to run once per agent */
  runCommands: string[];
  /** Primary dev server configuration */
  dev?: SandboxProcess;
  /** Background services */
  services: SandboxProcess[];
  /** Test commands */
  tests: SandboxProcess[];
  /** Files/directories to extract from agent */
  outputs: string[];
  /** Log file patterns agent can tail */
  logs: string[];
  /** Allowed external network hosts */
  netHosts: string[];
  /** Environment variables agent can use but not inspect */
  secrets: string[];
  /** INFER directive patterns (for auto-generation) */
  inferPatterns: string[];
}

type Directive =
  | "FROM"
  | "WORKDIR"
  | "RUN"
  | "DEV"
  | "SERVICE"
  | "TEST"
  | "OUTPUT"
  | "LOGS"
  | "NET"
  | "SECRET"
  | "INFER";

const DIRECTIVES = new Set<string>([
  "FROM",
  "WORKDIR",
  "RUN",
  "DEV",
  "SERVICE",
  "TEST",
  "OUTPUT",
  "LOGS",
  "NET",
  "SECRET",
  "INFER",
]);

function isIdentifier(s: string): boolean {
  if (s.length === 0) return false;
  return /^[a-zA-Z0-9_-]+$/.test(s);
}

function parseProcess(line: string, requireName: boolean): SandboxProcess {
  const result: SandboxProcess = { command: "" };
  const tokens = line.split(/\s+/).filter(t => t.length > 0);
  let i = 0;

  // For optional names (DEV/TEST): name must come BEFORE any KEY=VALUE pairs
  // For required names (SERVICE): name is always the first token

  // First, check if the first token is a name
  if (tokens.length > 0) {
    const firstToken = tokens[0];
    const firstHasEq = firstToken.includes("=");

    if (requireName) {
      // For SERVICE, the first token is always the name
      result.name = firstToken;
      i = 1;
    } else if (!firstHasEq && isIdentifier(firstToken) && tokens.length > 1) {
      // For DEV/TEST, check if first token could be a name
      // It's a name only if:
      // 1. It's an identifier (no special chars)
      // 2. It's NOT a KEY=VALUE pair
      // 3. The second token IS a KEY=VALUE pair
      const secondToken = tokens[1];
      const secondHasEq = secondToken.includes("=");

      if (secondHasEq) {
        // First token is a name, second is KEY=VALUE
        result.name = firstToken;
        i = 1;
      }
    }
  }

  // Parse KEY=VALUE pairs and command
  while (i < tokens.length) {
    const token = tokens[i];

    // Check if this is a KEY=VALUE pair
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      const key = token.substring(0, eqIdx);
      const value = token.substring(eqIdx + 1);

      if (key === "PORT") {
        const port = parseInt(value, 10);
        if (!isNaN(port)) {
          result.port = port;
        }
      } else if (key === "WATCH") {
        result.watch = value;
      }
      i++;
      continue;
    }

    // Everything remaining is the command
    result.command = tokens.slice(i).join(" ");
    break;
  }

  return result;
}

/**
 * Parse a Sandboxfile from a string
 */
export function parseSandboxfile(content: string): Sandboxfile {
  const result: Sandboxfile = {
    runCommands: [],
    services: [],
    tests: [],
    outputs: [],
    logs: [],
    netHosts: [],
    secrets: [],
    inferPatterns: [],
  };

  const lines = content.split("\n");

  for (const rawLine of lines) {
    // Handle Windows line endings and trim
    const line = rawLine.replace(/\r$/, "").trim();

    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    // Find the directive (first word)
    const firstSpace = line.search(/\s/);
    const directiveStr = firstSpace === -1 ? line : line.substring(0, firstSpace);
    const rest = firstSpace === -1 ? "" : line.substring(firstSpace).trim();

    if (!DIRECTIVES.has(directiveStr)) {
      // Unknown directive - skip with warning
      console.warn(`Unknown directive: ${directiveStr}`);
      continue;
    }

    const directive = directiveStr as Directive;

    switch (directive) {
      case "FROM":
        result.from = rest;
        break;
      case "WORKDIR":
        result.workdir = rest;
        break;
      case "RUN":
        result.runCommands.push(rest);
        break;
      case "DEV":
        result.dev = parseProcess(rest, false);
        break;
      case "SERVICE":
        result.services.push(parseProcess(rest, true));
        break;
      case "TEST":
        result.tests.push(parseProcess(rest, false));
        break;
      case "OUTPUT":
        result.outputs.push(rest);
        break;
      case "LOGS":
        result.logs.push(rest);
        break;
      case "NET":
        result.netHosts.push(rest);
        break;
      case "SECRET":
        result.secrets.push(rest);
        break;
      case "INFER":
        result.inferPatterns.push(rest);
        break;
    }
  }

  return result;
}

/**
 * Load and parse a Sandboxfile from a file path
 */
export async function loadSandboxfile(path: string): Promise<Sandboxfile> {
  const file = Bun.file(path);
  const content = await file.text();
  return parseSandboxfile(content);
}
