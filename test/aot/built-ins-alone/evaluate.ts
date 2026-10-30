const AsyncFunction = async function () {}.constructor as new (
  ...text: string[]
) => (...passed: unknown[]) => Promise<unknown>;

const load = (name: string) => require(name);

const importLine = /^import \{ (.*) \} from (".*");$/gm;

export function bodyOf(text: string): string {
  return `"use strict";\n${text.replace(importLine, "const { $1 } = load($2);")}`;
}

const turn = () => new Promise<void>(resolve => setTimeout(resolve, 1));

export async function within<T>(work: Promise<T>, otherwise: T, milliseconds = 200): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(otherwise), milliseconds);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Evaluation {
  failed: boolean;
  value: unknown;
  error: unknown;
}

export async function evaluate(text: string, names: string[] = [], values: unknown[] = []): Promise<Evaluation> {
  try {
    const work = new AsyncFunction("load", ...names, bodyOf(text))(load, ...values);
    const unfinished = Symbol();
    const value = await within<unknown>(work, unfinished);
    if (value === unfinished) return { failed: true, value: undefined, error: new Error("it does not finish") };
    return { failed: false, value, error: undefined };
  } catch (error) {
    return { failed: true, value: undefined, error };
  }
}

function shown(value: unknown): string {
  return typeof value === "string" ? value : Bun.inspect(value, { depth: 4 });
}

export interface Run {
  failed: boolean;
  output: string[];
}

export async function runProgram(text: string): Promise<Run> {
  const output: string[] = [];
  const log = (...values: unknown[]) => void output.push(values.map(shown).join(" "));
  const { failed } = await evaluate(text, ["console"], [{ log }]);
  await turn();
  await turn();
  return { failed, output };
}

export async function printsTheSameTwice(text: string): Promise<string[] | null> {
  const first = await runProgram(text);
  if (first.failed || first.output.length === 0) return null;
  const second = await runProgram(text);
  if (second.failed || second.output.join("\n") !== first.output.join("\n")) return null;
  return first.output;
}

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function literalOf(value: unknown, depth = 3): string | null {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "boolean":
      return String(value);
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return `${value}n`;
    case "object": {
      if (value === null) return "null";
      if (depth === 0) return null;
      if (Array.isArray(value)) {
        const parts = Array.from(value, each => literalOf(each, depth - 1));
        return parts.includes(null) ? null : `[${parts.join(", ")}]`;
      }
      if (value.constructor?.name === "Item") return "item";
      if (Object.getPrototypeOf(value) !== Object.prototype) return null;
      const parts = Object.entries(value).map(([key, each]) => {
        const text = literalOf(each, depth - 1);
        return text === null ? null : `${identifier.test(key) ? key : JSON.stringify(key)}: ${text}`;
      });
      return parts.includes(null) ? null : parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
    }
    default:
      return null;
  }
}

export function memberOf(text: string, key: string): string {
  if (/^(0|[1-9][0-9]*)$/.test(key)) return `${text}[${key}]`;
  return identifier.test(key) ? `${text}.${key}` : `${text}[${JSON.stringify(key)}]`;
}
