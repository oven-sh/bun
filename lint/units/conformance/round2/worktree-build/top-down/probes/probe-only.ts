import { probe } from "/workspace/wt/conformance/test/cli/lint/conformance/runner/check_bun_lint.ts";
for (const bin of process.argv.slice(2)) {
  const t0 = performance.now();
  const verdict = await probe({ command: [bin], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  console.log(bin, JSON.stringify(verdict), `${Math.round(performance.now() - t0)} ms`);
}
