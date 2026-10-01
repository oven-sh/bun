#!/usr/bin/env bash
# usage: lint-leak.sh [binary]   (default: the debug build of the worktree)
# `bun --lint` itself under the settings of the ASAN lane of CI (leak check, exception checks), on the two files of the
# probe of runner/check_bun_lint.ts and on a file with a rule report: the exit code and every line of stdout and stderr.
# A leak shows as a report of LeakSanitizer on stderr and another exit code than 0 or 2.
set -u
bin=${1:-/workspace/wt/conformance/build/debug/bun-debug}
tree=/workspace/wt/conformance
dir=$(mktemp -d /tmp/lint-leak-XXXXXX)
trap 'rm -rf "$dir"' EXIT
cat > "$dir/ok.ts" <<'TS'
const probe = globalThis as any;
probe.process.stdout.write("bun-lint-probe: " + "the file ran\n");
void probe.Bun.write("ran.txt", "ran");
export {};
TS
printf 'const = ;\n' > "$dir/bad.ts"
printf 'debugger;\nexport {};\n' > "$dir/rule.ts"
cd "$dir" || exit 1
for file in ok.ts bad.ts rule.ts; do
  env BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1 BUN_DEBUG_QUIET_LOGS=1 NO_COLOR=1 BUN_DESTRUCT_VM_ON_EXIT=1 \
    ASAN_OPTIONS=allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1 \
    "LSAN_OPTIONS=malloc_context_size=30:print_suppressions=0:suppressions=$tree/test/leaksan.supp" \
    BUN_JSC_validateExceptionChecks=1 BUN_JSC_dumpSimulatedThrows=1 BUN_GARBAGE_COLLECTOR_LEVEL=1 \
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 BUN_JSC_randomIntegrityAuditRate=1.0 \
    "$bin" --lint "$dir/$file" > "$dir/out.txt" 2> "$dir/err.txt"
  code=$?
  echo "$file: exit $code, stdout $(wc -c < "$dir/out.txt") bytes, stderr $(wc -l < "$dir/err.txt") lines, ran.txt $([ -e ran.txt ] && echo written || echo absent)"
  sed 's/^/    stderr: /' "$dir/err.txt" | cut -c1-220 | head -12
done
