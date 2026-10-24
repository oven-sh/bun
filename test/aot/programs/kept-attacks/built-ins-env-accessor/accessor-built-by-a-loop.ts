// An object of getters is built by a loop over a table of names: each getter reads the environment under its name and parses what it finds.
declare const process: { argv: string[]; env: Record<string, string | undefined> };
declare const console: { log(...values: any[]): void };
type Parser = (text: string | undefined) => unknown;
const asBoolean: Parser = text => text === "1" || text === "true";
const asText: Parser = text => text;
const asNumber: Parser = text => (text === undefined ? undefined : Number(text));
const shape: Record<string, Parser> = {};
for (let i = 0; i < 300; i++) shape["APP_OPTION_" + i] = i % 3 === 0 ? asBoolean : i % 3 === 1 ? asText : asNumber;
shape.APP_USE_FIRST = asBoolean; shape.APP_USE_SECOND = asBoolean; shape.APP_USE_THIRD = asBoolean; shape.APP_MANAGED = asBoolean; shape.APP_NAME = asText;
type Env = { readonly APP_USE_FIRST: boolean; readonly APP_USE_SECOND: boolean; readonly APP_USE_THIRD: boolean; readonly APP_MANAGED: boolean; readonly APP_NAME: string | undefined } & Record<string, unknown>;
function buildAccessor(table: Record<string, Parser>): object {
  const accessor = {};
  for (const key of Object.keys(table)) {
    const parse = table[key]!;
    Object.defineProperty(accessor, key, { enumerable: true, get: () => parse(process.env[key]) });
  }
  return accessor;
}
export const env = buildAccessor(shape) as Env;
const SWITCHES = ["APP_USE_FIRST", "APP_USE_SECOND", "APP_USE_THIRD"] as const;
function selectedBySwitch(): boolean { return SWITCHES.some(name => env[name]); }
export function provider(): string { return env.APP_USE_FIRST ? "first" : env.APP_USE_SECOND ? "second" : env.APP_USE_THIRD ? "third" : "own"; }
export function isRequired(): boolean { return !env.APP_MANAGED && !selectedBySwitch(); }
{ (globalThis as any).kept = [provider, isRequired, buildAccessor]; }
process.env.APP_NAME = "model";
const rounds = Number(process.argv[2] ?? 1000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += provider().length + (isRequired() ? 1 : 0);
console.log(sum, env.APP_NAME, env.APP_OPTION_2);
