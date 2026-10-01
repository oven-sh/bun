import { probe } from "/workspace/wt/conformance/test/cli/lint/conformance/runner/check_bun_lint";
const bins = { debug: "/workspace/wt/conformance/build/debug/bun-debug", release: "/workspace/wt/parser/build/release/bun", system: process.execPath };
const leak = {
  BUN_DESTRUCT_VM_ON_EXIT: "1",
  ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
  LSAN_OPTIONS: "malloc_context_size=30:print_suppressions=0:suppressions=/workspace/wt/conformance/test/leaksan.supp",
};
for (const [name, bin] of Object.entries(bins)) {
  for (const [envName, extra] of [["plain", {}], ["ci-leak", leak]] as const) {
    const t = performance.now();
    const verdict = await probe({ command: [bin], env: { ...process.env, ...extra } });
    console.log(name, envName, JSON.stringify(verdict), Math.round(performance.now() - t), "ms");
  }
}
