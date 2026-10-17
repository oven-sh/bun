#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    "build-dir": { type: "string", default: "build/release-local" },
    webkit: { type: "boolean", default: false },
    target: { type: "string", default: "x86_64-apple-macos" },
    jobs: { type: "string", default: "6" },
    only: { type: "string" },
    show: { type: "string", default: "60" },
  },
});

type Command = { directory: string; file: string; command?: string; arguments?: string[] };
const directory = resolve(args["build-dir"], args.webkit ? "deps/WebKit" : ".");
const only = args.only ? new RegExp(args.only) : undefined;
const commands = (JSON.parse(readFileSync(join(directory, "compile_commands.json"), "utf8")) as Command[]).filter(
  ({ file }) =>
    /\.(c|cc|cpp|mm)$/.test(file) &&
    (!args.webkit || (/\/(JavaScriptCore|WTF|bmalloc)\//.test(file) && !/\/Tools\//.test(file))) &&
    !/(LowLevelInterpreter|LLIntOffsetsExtractor)\.cpp$/.test(file) && // need what offlineasm generated for the host
    (!only || only.test(file)),
);

function split(command: string) {
  const words: string[] = [];
  for (const [, double, single, bare] of command.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|((?:[^\s"'\\]|\\.)+)/g))
    words.push(double !== undefined ? double.replace(/\\(.)/g, "$1") : (single ?? bare.replace(/\\(.)/g, "$1")));
  return words;
}

function forTarget({ command, arguments: list }: Command) {
  const words = list ? [...list] : split(command!);
  for (let at; (at = words.indexOf("-include-pch")) >= 0; ) words.splice(at - 1, 4);
  const kept: string[] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    if (["-o", "-MF", "-MT", "-arch"].includes(word)) at++;
    else if (word !== "-MD" && word !== "-c" && !/^(-mcpu=|-march=|-mtune=|--target=|-mmacosx-version-min=)/.test(word)) kept.push(word);
  }
  return [...kept, `--target=${args.target}`, "-fsyntax-only", "-ferror-limit=12", "-Wno-everything", "-fno-color-diagnostics"];
}

const errors = new Map<string, string>();
let failed = 0;
let next = 0;
await Promise.all(
  Array.from({ length: +args.jobs }, async () => {
    while (next < commands.length) {
      const command = commands[next++];
      const [compiler, ...rest] = forTarget(command);
      const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>(done => {
        const child = spawn(compiler, rest, { cwd: command.directory, stdio: ["ignore", "ignore", "pipe"] });
        const chunks: Buffer[] = [];
        child.stderr.on("data", chunk => chunks.push(chunk));
        child.on("close", code => done({ code, stderr: Buffer.concat(chunks).toString() }));
      });
      if (!code) continue;
      failed++;
      for (const line of stderr.split("\n")) {
        if (line.includes(" error: ") && !errors.has(line)) errors.set(line, basename(command.file));
      }
    }
  }),
);

console.log(`${commands.length} translation units, ${failed} do not compile for ${args.target}, ${errors.size} different errors`);
for (const line of [...errors.keys()].slice(0, +args.show)) console.log("  " + line);
process.exitCode = failed ? 1 : 0;
