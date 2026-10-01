// The two name lists of compiler_runner.go, read from the Go source text of a commit, against the lists of the port. No Go.
// usage: bun source_lists.ts <assembled runner set> <typescript-go clone> <commit>
const [asm, clone, commit] = process.argv.slice(2);
const R = await import(asm + "/test/cli/lint/conformance/runner/compiler_runner.ts");
const show = Bun.spawnSync(["git", "-C", clone, "show", `${commit}:internal/testrunner/compiler_runner.go`]);
if (show.exitCode !== 0) throw new Error(show.stderr.toString());
const text = show.stdout.toString("utf8");
const block = (head: string) => {
  const from = text.indexOf(head);
  if (from < 0) throw new Error("no declaration " + head);
  return text.slice(from, text.indexOf("\n}\n", from));
};
const strings = (s: string) => [...s.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*[,:]/gm)].map(m => JSON.parse(m[1]) as string);
const skipped = strings(block("var skippedTests = []string{"));
const emit = strings(block("var skippedEmitTests = map[string]string{"));
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
console.log(JSON.stringify({ skippedTests: skipped.length, sameAsPort: same(skipped, R.skippedTests), skippedEmitTests: emit.length, sameKeysAsPort: same(emit, [...R.skippedEmitTests.keys()]) }));
