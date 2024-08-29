const labels = [
  {
    name: "build",
    description: "An issue related to building or compiling Bun (not bun build)",
  },
  {
    name: "bun:crypto",
    description: "",
  },
  {
    name: "bun:dns",
    description: "Bun's DNS resolver",
  },
  {
    name: "bun:ffi",
    description: "Something related with FFI in Bun",
  },
  {
    name: "bun:fs",
    description: "",
  },
  {
    name: "bun:glob",
    description: "Related to Bun.Glob",
  },
  {
    name: "bun:http",
    description: "Bun.serve",
  },
  {
    name: "bun:jsc",
    description: "",
  },
  {
    name: "bun:semver",
    description: "Bun.semver",
  },
  {
    name: "bun:serve",
    description: "Bun.serve and HTTP server",
  },
  {
    name: "bun:spawn",
    description: "Bun.spawn, Bun.spawnSync",
  },
  {
    name: "bun:sqlite",
    description: "Something to do with bun:sqlite",
  },
  {
    name: "bun:tcp",
    description: "TCP sockets in Bun's API (Bun.connect, Bun.listen)",
  },
  {
    name: "bun:udp",
    description: "UDP sockets in Bun's API (Bun.udpSocket())",
  },

  {
    name: "bundler",
    description: "Something to do with the bundler",
  },
  {
    name: "bunx",
    description: "Something that has to do with `bunx`",
  },
  {
    name: "chore",
    description: "Task to improve the repository",
  },
  {
    name: "cjs",
    description: "CommonJS module",
  },
  {
    name: "cli",
    description: "Something to do with CLI arguments",
  },
  {
    name: "debugger",
    description: "Something to do with `bun --inspect` or the debugger",
  },
  {
    name: "docker",
    description: "An issue that occurs when running in Docker",
  },
  {
    name: "docs",
    description: "Improvements or additions to documentation",
  },
  {
    name: "ecosystem",
    description: "Something that relates to package or framework compatibility",
  },
  {
    name: "enhancement",
    description: "New feature or request",
  },
  {
    name: "idea",
    description: "",
  },
  {
    name: "infrastructure",
    description: "",
  },
  {
    name: "jest",
    description: "Something related to the `bun test` runner",
  },
  {
    name: "jsc",
    description: "Something related to JavaScriptCore, bun's JS engine",
  },
  {
    name: "lambda",
    description: "An issue related to the AWS Lambda layer",
  },
  {
    name: "linux",
    description: "An issue that only occurs on Linux",
  },
  {
    name: "macOS",
    description: "An issue that only occurs on macOS",
  },
  {
    name: "minifier",
    description: "bun's javascript minifier",
  },
  {
    name: "napi",
    description: "Compatibility with the native layer of Node.js",
  },
  {
    name: "node:crypto",
    description: "the node:crypto module",
  },
  {
    name: "node:dgram",
    description: "the node:dgram module",
  },
  {
    name: "node:dns",
    description: "the node:dns module",
  },
  {
    name: "node:fs",
    description: "the node:fs module",
  },
  {
    name: "node:http",
    description: "the node:http module",
  },
  {
    name: "node:http2",
    description: "the node:http2 module",
  },
  {
    name: "node:net",
    description: "the node:net module",
  },
  {
    name: "node:os",
    description: "the node:os module",
  },
  {
    name: "node:path",
    description: "the node:path module",
  },
  {
    name: "node:process",
    description: "the node:process module",
  },
  {
    name: "node:stream",
    description: "the node:stream module",
  },
  {
    name: "node:tty",
    description: "the node:tty module",
  },
  {
    name: "node:util",
    description: "the node:util module",
  },
  {
    name: "node:v8",
    description: "the node:v8 module",
  },
  {
    name: "node.js",
    description: "Compatibility with Node.js APIs",
  },
  {
    name: "npm",
    description: "Installing npm packages, npm registry, etc related to bun install",
  },
  {
    name: "npm:patch",
    description: "bun patch subcommand",
  },
  {
    name: "performance",
    description: "An issue with performance",
  },
  {
    name: "repl",
    description: "An issue with `bun repl`",
  },
  {
    name: "runtime",
    description: "Related to the JavaScript runtime",
  },
  {
    name: "shell",
    description: "Something to do with Bun as a shell",
  },
  {
    name: "sourcemaps",
    description: "Source maps",
  },
  {
    name: "transpiler",
    description: "parser || printer",
  },
  {
    name: "types",
    description: "An issue with TypeScript types",
  },
  {
    name: "typescript",
    description: "Something for TypeScript",
  },
  {
    name: "vscode",
    description: "Something to do with the VSCode extension",
  },
  {
    name: "wasm",
    description: "Something that related to WASM or WASI support",
  },
  {
    name: "web-api",
    description: "Something that relates to a standard Web API",
  },
  {
    name: "web:blob",
    description: "Blob",
  },
  {
    name: "web:crypto",
    description: "Related to crypto, SubtleCrypto",
  },
  {
    name: "web:encoding",
    description: "TextEncoder, TextDecoder, etc.",
  },
  {
    name: "web:fetch",
    description: "fetch api",
  },
  {
    name: "web:js",
    description: "",
  },
  {
    name: "web:performance",
    description: "Performance object",
  },
  {
    name: "web:stream",
    description: "Related to ReadableStream, WritableStream, etc.",
  },
  {
    name: "web:url",
    description: "Related to URL",
  },
  {
    name: "web:websocket",
    description: "Related to WebSocket client API",
  },
  {
    name: "windows",
    description: "An issue that only occurs on Windows",
  },
  {
    name: "wintercg",
    description: "Web-interoperable Runtimes Community Group compatiblity",
  },
];

import { Anthropic } from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function categorizeLabelsByClaudeAI(
  issueDetails: { title: string; body: string },
  labels: Array<{ name: string; description: string }>,
) {
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 2048,
    system: `Given this list of labels:
${labels.map(label => `- ${label.name}: ${label.description}`).join("\n")}

Please analyze the bug report and return a JSON array of label names that are most relevant to this issue. Only include labels that are highly relevant.

Only output VALID JSON. It's okay if there are no relevant labels.

The output should be a JSON array like so, with NO OTHER TEXT:

["label1", "label2", "label3"]
`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ title: issueDetails.title, body: issueDetails.body }, null, 2),
      },
    ],
  });
  let text = response.content[0].text;
  const start = text?.indexOf("[");
  if (start !== -1) {
    text = text.slice(start);
  }

  return JSON.parse(text);
}

const issue = {
  title: process.env.GITHUB_ISSUE_TITLE!,
  body: process.env.GITHUB_ISSUE_BODY!,
};
let relevantLabels = await categorizeLabelsByClaudeAI(issue, labels);
if (!relevantLabels?.length) {
  console.error("No relevant labels found");
  process.exit(0);
}

for (let i = 0; i < relevantLabels.length; i++) {
  if (!labels.find(label => label.name === relevantLabels[i])) {
    relevantLabels.splice(i, 1);
    i--;
  }
}

if (relevantLabels.length === 0) {
  console.error("No relevant labels found");
  process.exit(0);
}

console.write(relevantLabels.join(","));
