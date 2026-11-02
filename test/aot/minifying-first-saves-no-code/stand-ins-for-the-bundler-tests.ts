// What a test file of test/bundler imports from "bun:test" and from ./expectBundled, for ./bundler-suites.ts, which loads such a file for its inputs alone: `itBundled` writes its
// arguments down, `describe` runs its body, and nothing else does anything.
export const inputs: [id: string, input: Record<string, any>][] = [];

const nothing: any = new Proxy(function () {}, { get: () => nothing, apply: () => nothing });

const runBody = (_name: string, body: () => void) => body();
export const describe: any = Object.assign(runBody, { concurrent: runBody, serial: runBody, skip: nothing, todo: nothing, skipIf: () => nothing, todoIf: () => nothing, if: () => nothing }); // prettier-ignore
export const [test, it, expect, beforeAll, afterAll, beforeEach, afterEach] = [
  nothing,
  nothing,
  nothing,
  nothing,
  nothing,
  nothing,
  nothing,
];

export const itBundled: any = Object.assign(
  // An input that is a function is made for the folder it is written to.
  (id: string, input: Record<string, any> | Function) => {
    const options = typeof input === "function" ? { files: { "/entry.js": "{{root}}" } } : input;
    inputs.push([id, options]);
    return { id, options };
  },
  { skip: nothing, only: nothing },
);
export const ESBUILD_PATH = "";
export const ESBUILD = false;
export const RUN_UNCHECKED_TESTS = false;

/** As `dedent` of test/bundler/expectBundled.ts, which every file of an input goes through. */
export function dedent(text: string | TemplateStringsArray, ...values: unknown[]) {
  const whole = String.raw({ raw: text }, ...values).trim();
  const [first, ...rest] = whole.split("\n");
  let indent = Infinity;
  for (const line of rest) {
    const blanks = line.match(/^\s+/);
    if (!blanks) return whole;
    indent = Math.min(indent, blanks[0].length);
  }
  return indent === Infinity ? whole : [first, ...rest.map(line => line.slice(indent))].join("\n");
}
