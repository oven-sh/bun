// Small functions each read one field of a record of settings that declares many optional fields, and the objects have few of them.
declare const process: { argv: string[] };
declare const console: { log(...values: any[]): void };
type Settings = { model?: string; theme?: string; verbose?: boolean; editor?: string; timeout?: number; retries?: number; proxy?: string; region?: string; color?: boolean; shell?: string; name: string };
function modelOf(settings: Settings): string { return settings.model ?? "default"; }
function timeoutOf(settings: Settings): number { return settings.timeout ?? 30; }
function isVerbose(settings: Settings): boolean { return settings.verbose === true; }
function describe(settings: Settings): number {
  let n = settings.name.length + modelOf(settings).length + timeoutOf(settings);
  if (isVerbose(settings)) n += 1;
  return n;
}
const given: Settings[] = [{ name: "a" }, { name: "bc", theme: "dark" }, { model: "large", name: "d" }, { name: "e", retries: 3, color: true }];
{ (globalThis as any).kept = [describe, modelOf, timeoutOf, isVerbose, given]; const somebody: any = (globalThis as any)[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; Object.defineProperty(somebody, JSON.parse('"other"'), { get() { return 1; }, configurable: true }); }
const rounds = Number(process.argv[2]);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += describe(given[i & 3]!);
console.log(sum);
