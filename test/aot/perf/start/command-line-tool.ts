import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const verbs = ["add", "audit", "build", "cache", "check", "clean", "clone", "config", "deploy", "diff", "doctor", "export", "fetch", "format", "import", "info", "init", "link", "list", "login", "logout", "migrate", "publish", "remove", "run", "search", "status", "sync", "upgrade"];

function commandModule(verb: string, index: number): string {
  const title = verb[0].toUpperCase() + verb.slice(1);
  return `import { basename, join } from "node:path";
import { paint } from "../colors.ts";
import { UsageError } from "../errors.ts";
import { logger } from "../logger.ts";
import { type Command, type Context, type Option, flag, text } from "../options.ts";
import { pad, plural, slug } from "../strings.ts";

const pattern = /^(?:${verb}|${verb.slice(0, 2)})(?:-([a-z]+))?$/;
const limits = new Map<string, number>([["small", ${index + 3}], ["medium", ${index * 7 + 11}], ["large", ${index * 31 + 101}]]);
const aliases = new Set(["${verb.slice(0, 1)}", "${verb.slice(0, 2)}", "${verb}s"]);

const options: Option[] = [
  flag("force", "f", "${verb} without asking"),
  flag("dry-run", "n", "print what ${verb} would do"),
  text("target", "t", "where to ${verb}", "."),
  text("level", "l", "small, medium or large", "medium"),
];

interface ${title}Plan {
  target: string;
  level: number;
  steps: string[];
  force: boolean;
}

class ${title}Runner {
  static readonly kind = "${verb}";
  #done = 0;
  constructor(readonly plan: ${title}Plan) {}
  get remaining(): number {
    return this.plan.steps.length - this.#done;
  }
  step(): string | undefined {
    const next = this.plan.steps[this.#done];
    if (next !== undefined) this.#done++;
    return next;
  }
  describe(): string {
    return \`\${paint.bold(${title}Runner.kind)} \${basename(this.plan.target)}: \${plural(this.remaining, "step")}\`;
  }
}

function plan(context: Context): ${title}Plan {
  const level = limits.get(context.text("level"));
  if (level === undefined) throw new UsageError(\`${verb}: unknown level \${context.text("level")}\`);
  const target = join(context.directory, context.text("target"));
  const steps = Array.from({ length: level % 5 + 1 }, (_, step) => slug(\`${verb} \${step} \${target}\`));
  return { target, level, steps, force: context.flag("force") };
}

export function matches(name: string): boolean {
  return aliases.has(name) || pattern.test(name);
}

export const command: Command = {
  name: "${verb}",
  summary: "${title} the things of the project",
  options,
  matches,
  run(context) {
    const runner = new ${title}Runner(plan(context));
    logger.info(runner.describe());
    for (let step = runner.step(); step !== undefined; step = runner.step()) logger.debug(pad(step, 40));
    return runner.remaining;
  },
};
`;
}

const files: Record<string, string> = {
  "version.ts": `export const name = "cli50";\nexport const version = "1.2.3";\n`,
  "colors.ts": `const codes = { bold: [1, 22], dim: [2, 22], red: [31, 39], green: [32, 39], yellow: [33, 39], blue: [34, 39], magenta: [35, 39], cyan: [36, 39], gray: [90, 39] } as const;
type Name = keyof typeof codes;
const enabled = !process.env.NO_COLOR && process.stdout.isTTY === true;
function painter(open: number, close: number): (value: string) => string {
  return enabled ? value => \`\\x1b[\${open}m\${value}\\x1b[\${close}m\` : value => value;
}
export const paint = Object.fromEntries(Object.entries(codes).map(([name, [open, close]]) => [name, painter(open, close)])) as Record<Name, (value: string) => string>;
`,
  "errors.ts": `export class CliError extends Error {
  exitCode = 1;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class UsageError extends CliError {
  override exitCode = 2;
}
export class ConfigError extends CliError {
  override exitCode = 3;
}
export class NetworkError extends CliError {
  override exitCode = 4;
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export function exitCodeOf(error: unknown): number {
  return error instanceof CliError ? error.exitCode : 70;
}
`,
  "logger.ts": `import { EventEmitter } from "node:events";
import { paint } from "./colors.ts";
const levels = ["debug", "info", "warn", "error"] as const;
export type Level = (typeof levels)[number];
const prefixes: Record<Level, string> = { debug: paint.gray("debug"), info: paint.blue("info"), warn: paint.yellow("warn"), error: paint.red("error") };
class Logger extends EventEmitter {
  level: Level = (process.env.CLI_LOG as Level | undefined) ?? "warn";
  write(level: Level, message: string): void {
    if (levels.indexOf(level) < levels.indexOf(this.level)) return;
    this.emit("line", level, message);
    process.stderr.write(\`\${prefixes[level]} \${message}\\n\`);
  }
  debug(message: string) { this.write("debug", message); }
  info(message: string) { this.write("info", message); }
  warn(message: string) { this.write("warn", message); }
  error(message: string) { this.write("error", message); }
}
export const logger = new Logger();
`,
  "strings.ts": `export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
export function plural(count: number, noun: string): string {
  return \`\${count} \${noun}\${count === 1 ? "" : "s"}\`;
}
const notWord = /[^a-z0-9]+/g;
export function slug(value: string): string {
  return value.toLowerCase().replace(notWord, "-").replace(/^-|-$/g, "");
}
export function distance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length];
}
export function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}
`,
  "options.ts": `import { UsageError } from "./errors.ts";
export interface Option {
  name: string;
  short: string;
  summary: string;
  kind: "flag" | "text";
  fallback?: string;
}
export interface Command {
  name: string;
  summary: string;
  options: Option[];
  matches(name: string): boolean;
  run(context: Context): number | Promise<number>;
}
export const flag = (name: string, short: string, summary: string): Option => ({ name, short, summary, kind: "flag" });
export const text = (name: string, short: string, summary: string, fallback: string): Option => ({ name, short, summary, kind: "text", fallback });
export class Context {
  readonly #flags = new Set<string>();
  readonly #texts = new Map<string, string>();
  readonly rest: string[] = [];
  constructor(readonly directory: string, options: Option[], words: string[]) {
    const byName = new Map(options.flatMap(option => [["--" + option.name, option], ["-" + option.short, option]] as const));
    for (const option of options) if (option.fallback !== undefined) this.#texts.set(option.name, option.fallback);
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      const option = byName.get(word);
      if (!option) {
        if (word.startsWith("-")) throw new UsageError(\`unknown option \${word}\`);
        this.rest.push(word);
      } else if (option.kind === "flag") this.#flags.add(option.name);
      else this.#texts.set(option.name, words[++index] ?? "");
    }
  }
  flag(name: string): boolean {
    return this.#flags.has(name);
  }
  text(name: string): string {
    return this.#texts.get(name) ?? "";
  }
}
`,
  "config.ts": `import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "./errors.ts";
export interface Config {
  registry: string;
  retries: number;
  color: "auto" | "always" | "never";
  ignore: string[];
  scripts: Record<string, string>;
}
const defaults: Config = { registry: "https://registry.example.com", retries: 3, color: "auto", ignore: ["node_modules", "dist", ".git"], scripts: {} };
let loaded: Config | undefined;
export function config(directory: string): Config {
  if (loaded) return loaded;
  let merged = { ...defaults };
  for (const path of [join(homedir(), ".cli50.json"), join(directory, "cli50.json")]) {
    if (!existsSync(path)) continue;
    try {
      merged = { ...merged, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch (error) {
      throw new ConfigError(\`cannot read \${path}\`, { cause: error });
    }
  }
  return (loaded = merged);
}
`,
  "semver.ts": `const pattern = /^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+[0-9A-Za-z.-]+)?$/;
export class Version {
  constructor(readonly major: number, readonly minor: number, readonly patch: number, readonly tag: string | undefined) {}
  static parse(value: string): Version | undefined {
    const match = pattern.exec(value);
    return match ? new Version(+match[1], +match[2], +match[3], match[4]) : undefined;
  }
  compare(other: Version): number {
    return this.major - other.major || this.minor - other.minor || this.patch - other.patch || (this.tag === other.tag ? 0 : this.tag === undefined ? 1 : other.tag === undefined ? -1 : this.tag < other.tag ? -1 : 1);
  }
  toString(): string {
    return \`\${this.major}.\${this.minor}.\${this.patch}\${this.tag ? "-" + this.tag : ""}\`;
  }
}
`,
  "glob.ts": `const special = new Set([".", "+", "^", "$", "(", ")", "|", "{", "}", "[", "]", "\\\\"]);
const cache = new Map<string, RegExp>();
export function globToRegExp(glob: string): RegExp {
  let made = cache.get(glob);
  if (made) return made;
  let source = "^";
  for (let index = 0; index < glob.length; index++) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index++;
      } else source += "[^/]*";
    } else if (character === "?") source += "[^/]";
    else source += special.has(character) ? "\\\\" + character : character;
  }
  made = new RegExp(source + "$");
  cache.set(glob, made);
  return made;
}
`,
  "table.ts": `import { pad } from "./strings.ts";
export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, column) => (widths[column] = Math.max(widths[column] ?? 0, cell.length)));
  return rows.map(row => row.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd()).join("\\n");
}
`,
  "messages.ts": `export const messages = {
${Array.from({ length: 60 }, (_, index) => `  m${index}: "message number ${index}: something about ${verbs[index % verbs.length]} went {0} while {1}",`).join("\n")}
} as const;
export type MessageName = keyof typeof messages;
export function message(name: MessageName, ...values: string[]): string {
  return messages[name].replace(/\\{(\\d)\\}/g, (_, index: string) => values[+index] ?? "");
}
`,
  "platform.ts": `import { arch, platform, release } from "node:os";
export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isCI = Boolean(process.env.CI);
export const shells: Record<string, string[]> = { linux: ["/bin/sh", "-c"], darwin: ["/bin/sh", "-c"], win32: ["cmd.exe", "/d", "/s", "/c"] };
export function describePlatform(): string {
  return \`\${platform()} \${arch()} \${release()}\`;
}
`,
  "retry.ts": `import { NetworkError } from "./errors.ts";
import { logger } from "./logger.ts";
export async function retry<T>(times: number, work: (attempt: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= times; attempt++) {
    try {
      return await work(attempt);
    } catch (error) {
      last = error;
      if (error instanceof NetworkError && error.status < 500) break;
      logger.warn(\`attempt \${attempt} failed\`);
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 10));
    }
  }
  throw last;
}
`,
  "cache.ts": `export class LeastRecentlyUsed<Key, Value> {
  readonly #entries = new Map<Key, Value>();
  constructor(readonly capacity: number) {}
  get(key: Key): Value | undefined {
    const value = this.#entries.get(key);
    if (value !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, value);
    }
    return value;
  }
  set(key: Key, value: Value): void {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    if (this.#entries.size > this.capacity) for (const oldest of this.#entries.keys()) { this.#entries.delete(oldest); break; }
  }
}
export const shared = new LeastRecentlyUsed<string, string>(128);
`,
  "schema.ts": `type Check = (value: unknown) => string | undefined;
export const string: Check = value => (typeof value === "string" ? undefined : "expected a string");
export const number: Check = value => (typeof value === "number" ? undefined : "expected a number");
export const boolean: Check = value => (typeof value === "boolean" ? undefined : "expected a boolean");
export const arrayOf = (check: Check): Check => value => (Array.isArray(value) ? value.map(check).find(Boolean) : "expected an array");
export const oneOf = (...allowed: string[]): Check => value => (allowed.includes(value as string) ? undefined : \`expected one of \${allowed.join(", ")}\`);
export const shape = (fields: Record<string, Check>): Check => value => {
  if (typeof value !== "object" || value === null) return "expected an object";
  for (const [name, check] of Object.entries(fields)) {
    const problem = check((value as Record<string, unknown>)[name]);
    if (problem) return \`\${name}: \${problem}\`;
  }
  return undefined;
};
export const configSchema = shape({ registry: string, retries: number, color: oneOf("auto", "always", "never"), ignore: arrayOf(string) });
`,
  "help.ts": `import { paint } from "./colors.ts";
import type { Command } from "./options.ts";
import { wrap } from "./strings.ts";
import { table } from "./table.ts";
import { name, version } from "./version.ts";
export function help(commands: readonly Command[]): string {
  return [\`\${paint.bold(name)} \${version}\`, "", "Commands:", table(commands.map(command => ["  " + command.name, wrap(command.summary, 60).join(" ")])), ""].join("\\n");
}
export function commandHelp(command: Command): string {
  return [\`\${name} \${command.name}: \${command.summary}\`, "", table(command.options.map(option => [\`  -\${option.short}, --\${option.name}\`, option.summary]))].join("\\n");
}
`,
  "suggest.ts": `import { distance } from "./strings.ts";
export function suggest(word: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let least = 3;
  for (const candidate of known) {
    const far = distance(word, candidate);
    if (far < least) {
      least = far;
      best = candidate;
    }
  }
  return best;
}
`,
  "hooks.ts": `type Hook = (name: string) => void | Promise<void>;
const before: Hook[] = [];
const after: Hook[] = [];
export const onBefore = (hook: Hook) => void before.push(hook);
export const onAfter = (hook: Hook) => void after.push(hook);
export async function around<T>(name: string, work: () => T | Promise<T>): Promise<T> {
  for (const hook of before) await hook(name);
  try {
    return await work();
  } finally {
    for (const hook of after) await hook(name);
  }
}
`,
  "telemetry.ts": `import { onAfter, onBefore } from "./hooks.ts";
import { isCI } from "./platform.ts";
const started = new Map<string, number>();
export const timings: Record<string, number> = {};
if (!isCI && !process.env.DO_NOT_TRACK) {
  onBefore(name => void started.set(name, performance.now()));
  onAfter(name => void (timings[name] = performance.now() - (started.get(name) ?? 0)));
}
`,
  "commands/index.ts": `${verbs.map(verb => `import { command as ${verb === "export" || verb === "import" ? verb + "Command" : verb} } from "./${verb}.ts";`).join("\n")}
import type { Command } from "../options.ts";
export const commands: readonly Command[] = Object.freeze([${verbs.map(verb => (verb === "export" || verb === "import" ? verb + "Command" : verb)).join(", ")}]);
`,
  "main.ts": `import { commands } from "./commands/index.ts";
import { shared } from "./cache.ts";
import { config } from "./config.ts";
import { exitCodeOf, UsageError } from "./errors.ts";
import { globToRegExp } from "./glob.ts";
import { commandHelp, help } from "./help.ts";
import { around } from "./hooks.ts";
import { logger } from "./logger.ts";
import { message } from "./messages.ts";
import { Context } from "./options.ts";
import { describePlatform } from "./platform.ts";
import { retry } from "./retry.ts";
import { configSchema } from "./schema.ts";
import { Version } from "./semver.ts";
import { suggest } from "./suggest.ts";
import "./telemetry.ts";
import { name, version } from "./version.ts";

async function main(words: string[]): Promise<number> {
  const [first, ...rest] = words;
  if (first === "--version" || first === "-v") {
    console.log(\`\${name} \${version}\`);
    return 0;
  }
  if (first === undefined || first === "--help" || first === "-h") {
    console.log(help(commands));
    return 0;
  }
  if (first === "--platform") {
    console.log(describePlatform(), Version.parse(version)?.toString(), globToRegExp("**/*.ts").source, shared.capacity);
    return 0;
  }
  const command = commands.find(each => each.matches(first));
  if (!command) {
    const near = suggest(first, commands.map(each => each.name));
    throw new UsageError(message("m1", first, near ? \`did you mean \${near}?\` : "no such command"));
  }
  if (rest.includes("--help")) {
    console.log(commandHelp(command));
    return 0;
  }
  const directory = process.cwd();
  const problem = configSchema(config(directory));
  if (problem) throw new UsageError(problem);
  return around(command.name, () => retry(1, async () => command.run(new Context(directory, command.options, rest))));
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  error => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeOf(error);
  },
);
`,
};

verbs.forEach((verb, index) => (files[`commands/${verb}.ts`] = commandModule(verb, index)));

export function writeCommandLineTool(folder: string): number {
  mkdirSync(join(folder, "commands"), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);
  return Object.keys(files).length;
}

