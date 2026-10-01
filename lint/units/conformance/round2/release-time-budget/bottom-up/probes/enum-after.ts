// usage: bun enum-after.ts <runner dir> [calls]
const [runnerDir, callsArg] = process.argv.slice(2);
const { enumerateInstances } = await import(`${runnerDir}/compiler_runner.ts`);
for (let k = 0; k < Number(callsArg ?? 1); k++) enumerateInstances("/tmp/rtb1a/repo/test/cli/lint/conformance/corpus/cases");
