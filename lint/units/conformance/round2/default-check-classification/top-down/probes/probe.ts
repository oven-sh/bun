import { probe } from "/tmp/dcc-scratch/test/cli/lint/conformance/runner/check_bun_lint";
for (const bin of process.argv.slice(2)) {
  const t = performance.now();
  const verdict = await probe({ command: [bin], env: process.env });
  console.log(bin, JSON.stringify(verdict), Math.round(performance.now() - t), "ms");
}
