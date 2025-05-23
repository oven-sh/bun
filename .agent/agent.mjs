import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";

function claudeExists() {
  try {
    const { status } = spawnSync("claude", ["--version"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return status === 0;
  } catch {
    return false;
  }
}

function bunExists() {
  return "Bun" in globalThis;
}

function installClaude() {
  const packageManager = bunExists() ? "bun" : "npm";
  const installCmd = packageManager === "bun" ? ["add", "-g"] : ["install", "-g"];

  const result = spawnSync(packageManager, [...installCmd, "claude"], {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`Failed to install claude using ${packageManager}`);
    console.error("Please install claude manually:");
    console.error("  npm install -g claude");
    console.error("  or");
    console.error("  bun add -g claude");
    process.exit(1);
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    help: {
      type: "boolean",
      short: "h",
      default: false,
    },
    interactive: {
      type: "boolean",
      short: "i",
      default: false,
    },
  },
});

if (values.help) {
  console.log("Usage: node agent.mjs <prompt_name> [extra_args...]");
  console.log("Example: node agent.mjs triage fix bug in authentication");
  console.log("Options:");
  console.log("  -h, --help         Show this help message");
  console.log("  -i, --interactive  Run in interactive mode");
  process.exit(0);
}

if (positionals.length === 0) {
  console.error("Usage: node agent.mjs <prompt_name> [extra_args...]");
  console.error("Example: node agent.mjs triage fix bug in authentication");
  console.error("Options:");
  console.error("  -h, --help         Show this help message");
  console.error("  -i, --interactive  Run in interactive mode");
  process.exit(1);
}

const promptName = positionals[0].toLowerCase();
const promptFile = `.agent/${promptName}.md`;
const extraArgs = positionals.slice(1);

if (!existsSync(promptFile)) {
  console.error(`Error: Prompt file "${promptFile}" not found`);
  console.error(`Available prompts should be named like: .agent/triage.md, .agent/debug.md, etc.`);
  process.exit(1);
}

try {
  if (!claudeExists()) {
    installClaude();
  }

  let prompt = readFileSync(promptFile, "utf-8");

  const githubEnvs = Object.entries(process.env)
    .filter(([key]) => key.startsWith("GITHUB_"))
    .sort(([a], [b]) => a.localeCompare(b));

  if (githubEnvs.length > 0) {
    const githubContext = `## GitHub Environment\n\n${githubEnvs
      .map(([key, value]) => `**${key}**: \`${value}\``)
      .join("\n")}\n\n---\n\n`;
    prompt = githubContext + prompt;
  }

  if (extraArgs.length > 0) {
    const extraArgsContext = `\n\n## Additional Arguments\n\n${extraArgs.join(" ")}\n\n---\n\n`;
    prompt = prompt + extraArgsContext;
  }

  const claudeArgs = [
    prompt,
    "--dangerously-skip-permissions",
    "--allowedTools=Edit,Write,Search,Bash(*)",
    "--output-format=json",
  ];
  if (!values.interactive) {
    claudeArgs.unshift("--print");
  }

  const result = spawnSync("claude", claudeArgs, {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (result.error) {
    console.error("Error running claude:", result.error.message);
    process.exit(1);
  }

  process.exit(result.status || 0);
} catch (error) {
  console.error(`Error reading prompt file "${promptFile}":`, error.message);
  process.exit(1);
}
