export const meta = {
  name: "phase-h-windows-bughunt",
  description:
    "Adversarial bug-hunt on all Windows code (cfg(windows) blocks). Shard by file → 2 hunters per file vs .zig spec → bugfix → compile.",
  phases: [
    { title: "Shard", detail: "list all files with cfg(windows) / windows-only code" },
    { title: "Hunt", detail: "2 adversarial hunters per file vs .zig spec" },
    { title: "Fix", detail: "apply UB/leak/semantics/race findings" },
    { title: "Compile", detail: "5-target clean-leaf + commit" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-libuv-audit"; // share worktree with libuv-audit (both Windows-focused)

const SHARD_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, win_lines: { type: "number" } },
        required: ["file"],
      },
    },
  },
  required: ["files"],
};
const HUNT_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          zig_spec: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string", enum: ["ub", "leak", "semantics", "race", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["file", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: { file: { type: "string" }, applied: { type: "number" }, notes: { type: "string" } },
  required: ["file", "applied"],
};
const COMPILE_S = {
  type: "object",
  properties: { rounds: { type: "number" }, errors_after: { type: "number" }, commit: { type: "string" } },
  required: ["errors_after"],
};

const NO_TOOLS = `**HARD RULES:** Work in ${WT}. **DO NOT** run cargo/git/bun (until Compile). Read/Grep/Glob OK.`;

phase("Shard");
const shard = await agent(
  `List all files with Windows-specific code. Repo ${WT}.

\`grep -rln 'cfg(windows)\\|cfg(target_os = "windows")\\|IS_WINDOWS\\|#\\[cfg(windows)\\]' ${WT}/src/ --include='*.rs'\` plus everything in src/windows_sys/, src/libuv_sys/, src/install/windows-shim/, files named *Windows*.

For each: count lines under cfg(windows) (or all lines if Windows-only file).

${NO_TOOLS}

Return {files:[{file, win_lines}]}.`,
  { label: "shard", phase: "Shard", schema: SHARD_S },
);
if (!shard || !shard.files.length) return { error: "no files" };
const files = shard.files.filter(f => (f.win_lines || 0) > 5);
log(`${files.length} files with Windows code`);

const HUNT_BRIEF = `
**Bug classes to hunt (Windows-specific):**

1. **HANDLE leak**: \`CreateFileW\`/\`OpenProcess\`/etc. without paired \`CloseHandle\` on every path (incl. error). Zig used \`defer fd.close()\`; Rust needs Drop or explicit close on all branches.
2. **WCHAR/UTF-16 NUL**: Windows wide strings need NUL-terminated \`&[u16]\` — check \`encode_wide()\` output has trailing 0; check buffer-size passed to W-suffix APIs is in CHARS not BYTES.
3. **DWORD signedness**: \`GetLastError()\` is u32 but errno comparisons may be i32; \`as i32\` of DWORD>i32::MAX is wrong.
4. **\`INVALID_HANDLE_VALUE\` vs null**: some APIs return -1, some return null. Check the right sentinel per MSDN.
5. **Path separator**: hardcoded \`/\` in Windows-only code; \`MAX_PATH\` vs long-path (\`\\\\?\\\` prefix).
6. **uv handle ownership**: same as libuv-audit (Box drops before async close, double from_raw, etc.).
7. **OVERLAPPED lifetime**: struct must outlive the async I/O; can't be stack-local across await.
8. **Spec divergence**: ANY behavior difference vs .zig spec at same path (different error code, different fallback, missing case).
9. **TOCTOU**: stat-then-open without share-mode handling.
10. **CRT/libc on Windows**: any \`libc::*\` call in Windows code that should be a Win32 call (MSVCRT semantics differ from POSIX).
`;

phase("Hunt");
const hunted = await pipeline(
  files,
  f =>
    parallel(
      [0, 1].map(
        i => () =>
          agent(
            `Adversarially hunt bugs in Windows code of **${f.file}** (~${f.win_lines} Windows lines). Repo ${WT}.

${HUNT_BRIEF}

**Process:**
1. Read ${f.file} fully (focus on cfg(windows) blocks). Read .zig spec at same path.
2. For EACH cfg(windows) block, compare line-by-line to .zig spec. Cite zig_spec line for any divergence.
3. Check the 10 bug classes above. Be ADVERSARIAL — assume there ARE bugs (this code was compiled but never run on Windows; the prior fix round was for COMPILE errors, not correctness).

Only report HIGH-CONFIDENCE bugs with line+why+fix. ${NO_TOOLS}

Return {file:"${f.file}", bugs:[{line,what,why_wrong,zig_spec,fix,severity}]}.`,
            { label: `hunt${i}:${f.file.split("/").pop()}`, phase: "Hunt", schema: HUNT_S },
          ),
      ),
    ).then(votes => {
      const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
      const seen = {};
      const bugs = all.filter(b => {
        const k = `${b.line || 0}::${(b.what || "").slice(0, 60)}`;
        if (seen[k]) return false;
        seen[k] = 1;
        return true;
      });
      const blocking = bugs.filter(b => ["ub", "leak", "semantics", "race"].includes(b.severity));
      return { file: f.file, bugs, blocking };
    }),
  (vr, f) =>
    vr && vr.blocking && vr.blocking.length > 0
      ? agent(
          `Apply Windows bug fixes to **${f.file}**. Repo ${WT}.

**${vr.blocking.length} BLOCKING:**
${vr.blocking.map((b, i) => `${i + 1}. [${b.severity}] L${b.line || "?"}: ${b.what}\n   WHY: ${b.why_wrong}\n   ZIG: ${b.zig_spec || ""}\n   FIX: ${b.fix}`).join("\n")}

Edit ${f.file}. Match .zig spec exactly. ${NO_TOOLS} (Edit OK)

Return {file:"${f.file}", applied:N, notes}.`,
          { label: `fix:${f.file.split("/").pop()}`, phase: "Fix", schema: FIX_S },
        ).then(a => ({ ...vr, fix: a }))
      : vr,
);

const allBugs = hunted.filter(Boolean).flatMap(r => (r.bugs || []).map(b => ({ file: r.file, ...b })));
const allBlocking = allBugs.filter(b => ["ub", "leak", "semantics", "race"].includes(b.severity));

phase("Compile");
const compile = await agent(
  `FINAL: compile + commit Windows bughunt fixes. Repo ${WT}. **You may use cargo/git.**

${hunted.filter(r => r && r.fix).length} files fixed.

1. \`cd ${WT} && cargo check --workspace --keep-going 2>&1 | grep -cE '^error\\['\` → fix loop ≤6.
2. 5-target clean-leaf (esp. Windows): \`for t in x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-unknown-linux-gnu; do cargo clean -p bun_runtime -p bun_bin --target $t 2>/dev/null; cargo check -p bun_bin --target $t 2>&1 | grep -cE '^error\\['; done\`.
3. \`bun bd --version\` exit 0 + inspect 72/0.
4. \`git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-h: Windows bughunt (${allBlocking.length} fixes)"\`. NO push.

Return {rounds, errors_after, commit}.`,
  { label: "compile-fix-commit", phase: "Compile", schema: COMPILE_S },
);

return {
  files: files.length,
  total_bugs: allBugs.length,
  blocking: allBlocking,
  by_severity: {
    ub: allBugs.filter(b => b.severity === "ub").length,
    leak: allBugs.filter(b => b.severity === "leak").length,
    race: allBugs.filter(b => b.severity === "race").length,
    semantics: allBugs.filter(b => b.severity === "semantics").length,
    style: allBugs.filter(b => b.severity === "style").length,
  },
  files_fixed: hunted.filter(r => r && r.fix).length,
  compile,
};
