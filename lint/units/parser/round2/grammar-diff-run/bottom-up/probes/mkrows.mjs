// <patched bun> mkrows.mjs rows.reject.json neighbours.json > rejected-rows.ts.txt
// The test block: per construct a source that stays accepted (valid for tsc, new with the branch) and the sources that are
// rejected again, each with the first error of the binary that runs this file.
import { readFileSync } from "node:fs";
const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }), decorators: new Bun.Transpiler({ loader: "ts", tsconfig }) };
const first = (t, src) => { try { transpilers[t].transformSync(src); return null; } catch (e) { const list = e && Array.isArray(e.errors) && e.errors.length ? e.errors : [e]; return String(list[0]?.message ?? list[0]); } };
const neighbours = JSON.parse(readFileSync(process.argv[3], "utf8"));
let accepted = 0, neighbourRejected = 0;
console.log(`/** A transpiler, a source that tsc 6.0.2 rejects with its parser or with a grammar check of its checker, and the first error of Bun. */
type Rejected = [transpiler: keyof typeof transpilers, source: string, message: string];

/** The message of the first error that the transpiler reports for the source. */
function firstError(transpiler: keyof typeof transpilers, source: string): string {
  try {
    transpilers[transpiler].transformSync(source);
  } catch (e: any) {
    const list = Array.isArray(e?.errors) && e.errors.length > 0 ? e.errors : [e];
    return String(list[0]?.message ?? list[0]);
  }
  return "no error";
}

// In every table the first source is valid for tsc as a whole and new with this grammar. The rows are what tsc rejects beside it.
describe("TypeScript that tsc rejects stays an error", () => {`);
for (const [group, rows] of JSON.parse(readFileSync(process.argv[2], "utf8"))) {
  const id = group.split(" ")[0];
  const [nt, nsrc] = neighbours[id] ?? neighbours[id === "C1" ? "O4" : id];
  if (first(nt, nsrc) !== null) { neighbourRejected++; console.log(`  // NEIGHBOUR REJECTED BY THIS BINARY: ${JSON.stringify([nt, nsrc])} ${first(nt, nsrc)}`); }
  console.log("  test.each<Rejected>([");
  for (const [t, src] of rows) {
    const m = first(t, src);
    if (m === null) { accepted++; console.log(`    // ACCEPTED BY THIS BINARY: ${JSON.stringify([t, src])}`); continue; }
    console.log(`    [${JSON.stringify(t)}, ${JSON.stringify(src)}, ${JSON.stringify(m)}],`);
  }
  console.log(`  ])(${JSON.stringify(group.replace(/^\w+ /, "") + ": %s %j")}, (transpiler, source, message) => {
    expect(firstError(${JSON.stringify(nt)}, ${JSON.stringify(nsrc)})).toBe("no error");
    expect(firstError(transpiler, source)).toBe(message);
  });
`);
}
console.log("});");
console.error(`${accepted} rows are accepted by this binary, ${neighbourRejected} neighbours are rejected by it`);
