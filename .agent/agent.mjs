import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseArgs } from "node:util";

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

if (values.help || positionals.length === 0) {
  console.log("Usage: node agent.mjs <prompt_name> [extra_args...]");
  console.log("Example: node agent.mjs triage fix bug in authentication");
  console.log("Options:");
  console.log("  -h, --help         Show this help message");
  console.log("  -i, --interactive  Run in interactive mode");
  process.exit(0);
}

const promptName = positionals[0].toUpperCase();
const promptFile = `.agent/${promptName}.md`;
const extraArgs = positionals.slice(1);

if (!existsSync(promptFile)) {
  console.error(`Error: Prompt file "${promptFile}" not found`);
  console.error(`Available prompts should be named like: .agent/triage.md, .agent/debug.md, etc.`);
  process.exit(1);
}

try {
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

  const claudeArgs = [prompt, "--allowedTools=Edit,Write,Replace,Search", "--output-format=json"];
  if (!values.interactive) {
    claudeArgs.unshift("--print");
  }

  const { status, error } = spawnSync("claude", claudeArgs, {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (error) {
    console.error("Error running claude:", error);
    process.exit(1);
  }

  process.exit(status || 0);
} catch (error) {
  console.error(`Error reading prompt file "${promptFile}":`, error);
  process.exit(1);
}
