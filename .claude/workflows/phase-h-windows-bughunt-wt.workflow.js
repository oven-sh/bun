export const meta = {
  name: "phase-h-windows-bughunt-wt",
  description:
    "Adversarial Windows bug-hunt (worktree-isolated). Shard cfg(windows) files → 2 hunters per file vs .zig spec → fix-agent in worktree returns patch → 2-vote review.",
  phases: [
    { title: "Shard", detail: "list files with cfg(windows) blocks" },
    { title: "Hunt", detail: "2 adversarial hunters per file, read-only" },
    { title: "Fix", detail: "worktree-isolated fix per file with bugs, return patch" },
    { title: "Review", detail: "2-vote review of each patch" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const REPO = A.repo || "C:\\Users\\dylan\\code\\bun";
const MAX_FILES = A.max_files || 30; // cap so one round stays bounded
const MIN_WIN_LINES = A.min_win_lines || 10;
const FOCUS = A.focus || ""; // optional substring filter on file path

const SHARD_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { file: { type: "string" }, win_lines: { type: "number" } },
        required: ["file", "win_lines"],
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
          severity: { type: "string", enum: ["ub", "leak", "semantics", "race", "abi", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["file", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    files_edited: { type: "array", items: { type: "string" } },
    applied: { type: "number" },
    summary: { type: "string" },
    patch: { type: "string" },
    zig_spec_match: { type: "string" },
  },
  required: ["file", "files_edited", "applied", "patch", "zig_spec_match"],
};
const REVIEW_S = {
  type: "object",
  properties: {
    accept: { type: "boolean" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          severity: { type: "string" },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["accept", "bugs"],
};

const HUNT_BRIEF = `**Bug classes (Windows-specific):**
1. **HANDLE leak**: Create*/Open* without paired CloseHandle on every path. Zig used \`defer fd.close()\`.
2. **WCHAR/UTF-16**: missing NUL; buffer-size in chars-vs-bytes to W-suffix APIs.
3. **DWORD signedness**: GetLastError u32 vs i32 errno compares.
4. **INVALID_HANDLE_VALUE vs null**: wrong sentinel per-API.
5. **Path sep**: hardcoded '/' in Windows-only code; MAX_PATH vs \\\\?\\ long-path.
6. **uv handle ownership**: Box<uv::T> auto-drop while async close pending; double from_raw.
7. **OVERLAPPED lifetime**: stack-local across async await.
8. **Spec divergence**: ANY behavior diff vs .zig at same path (different errno, fallback, missing case).
9. **NTSTATUS→errno**: must use translate_ntstatus_to_errno table, NOT RtlNtStatusToDosError chain.
10. **Self-ref struct moves**: uv_fs_t after read/write — moving before req_cleanup frees stack ptr.
11. **cfg-arm sync**: signature change applied to one cfg arm but not the other.
12. **SysV-vs-Win64 ABI**: extern "C" where C++ declares SYSV_ABI/JSC_CALLCONV (or inverse).
13. **panic vs Global::crash on worker threads**: panic!() under panic="unwind" on a pool thread → caller hangs.`;

phase("Shard");
const shard = await agent(
  `List files with Windows-specific code in ${REPO}. Read-only.

\`grep -rln 'cfg(windows)\\|cfg(target_os = "windows")\\|#\\[cfg(windows)\\]' src/ --include='*.rs'\` plus everything in src/windows_sys/, src/libuv_sys/, src/install/windows-shim/, files named *Windows*.

For each: estimate win_lines (lines under cfg(windows), or whole file if Windows-only). ${FOCUS ? `FILTER to paths containing "${FOCUS}".` : ""} Return top ${MAX_FILES} by win_lines (skip files <${MIN_WIN_LINES} win_lines).

NO edits, NO git/cargo/bun.

Return {files:[{file, win_lines}]}.`,
  { label: "shard", phase: "Shard", schema: SHARD_S },
);
if (!shard || !shard.files.length) return { error: "no files" };
log(`${shard.files.length} files`);

phase("Hunt");
const results = await pipeline(
  shard.files,
  // Hunt: 2 read-only hunters per file
  f =>
    parallel(
      [0, 1].map(
        i => () =>
          agent(
            `Adversarially hunt bugs in Windows code of **${f.file}** (~${f.win_lines} Windows lines). Repo ${REPO}. Read-only.

${HUNT_BRIEF}

**Process:**
1. Read ${f.file} fully (focus on cfg(windows) blocks). Read .zig spec at same path.
2. For EACH cfg(windows) block, compare vs .zig spec line-by-line. Cite zig_spec line.
3. Check the 13 classes. Be ADVERSARIAL — assume bugs exist (this code compiles cross-target but is rarely run natively).

Only report HIGH-CONFIDENCE bugs with line+why+fix. NO edits, NO git/cargo/bun.

Return {file:"${f.file}", bugs:[{line,what,why_wrong,zig_spec,fix,severity}]}.`,
            { label: `hunt${i}:${f.file.split(/[\\/]/).pop()}`, phase: "Hunt", schema: HUNT_S },
          ),
      ),
    ).then(votes => {
      const all = (votes || []).filter(Boolean).flatMap(v => v.bugs || []);
      const seen = {};
      const bugs = all.filter(b => {
        const k = `${b.line || 0}::${(b.what || "").slice(0, 60)}`;
        return seen[k] ? false : (seen[k] = 1);
      });
      const blocking = bugs.filter(b => ["ub", "leak", "semantics", "race", "abi"].includes(b.severity));
      return { file: f.file, bugs, blocking };
    }),
  // Fix: worktree-isolated, returns patch
  (h, f) =>
    h && h.blocking.length > 0
      ? agent(
          `Apply Windows bug fixes to **${f.file}**. ISOLATED worktree.

**FIRST:** \`git fetch origin claude/phase-a-port && git checkout origin/claude/phase-a-port -- .\` to sync to port-branch HEAD.

**${h.blocking.length} BLOCKING bugs:**
${h.blocking.map((b, i) => `${i + 1}. [${b.severity}] L${b.line || "?"}: ${b.what}\n   WHY: ${b.why_wrong}\n   ZIG: ${b.zig_spec || ""}\n   FIX: ${b.fix}`).join("\n")}

Edit ${f.file} (and only that file unless a fix forces a cross-file change). Match .zig spec. NO \`#[cfg(any())]\`/\`todo!()\`. NEW \`unsafe\` only with SAFETY:. Be conservative — if a finding looks wrong on closer reading, SKIP it (note in summary).

After editing: \`git diff -- src/\` → patch. NO cargo/bun. NO git commit/push/stash/reset.

Return {file:"${f.file}", files_edited:[...], applied:N, summary, patch, zig_spec_match:"<file:line> OR 'not-spec: <why>'"}.`,
          { label: `fix:${f.file.split(/[\\/]/).pop()}`, phase: "Fix", schema: FIX_S, isolation: "worktree" },
        ).then(fix => ({ ...h, fix }))
      : h,
  // Review: 2-vote on the patch
  (h, f) =>
    h && h.fix && h.fix.patch && h.fix.patch.length > 10
      ? parallel(
          [0, 1].map(
            i => () =>
              agent(
                `Adversarially review Windows bug-fix patch for **${f.file}**. Repo ${REPO}. Read-only. DEFAULT accept:true.

**Summary:** ${h.fix.summary}
**Spec-match claim:** ${h.fix.zig_spec_match}

**PATCH:**
\`\`\`diff
${h.fix.patch.slice(0, 8000)}
\`\`\`

Read full file in ${REPO} + .zig spec. Check:
1. **Spec-match**: verify the claim. If "not-spec", agree it's the right layer?
2. **Correctness**: each hunk actually fixes a real bug (not a hunter false-positive)?
3. **UB/ABI/Regression**: aliased &mut? wrong cfg-gate? breaks non-Windows?

NO edits, NO git/cargo/bun.

Return {accept, bugs:[{file,what,why_wrong,severity}]}.`,
                { label: `rev${i}:${f.file.split(/[\\/]/).pop()}`, phase: "Review", schema: REVIEW_S },
              ),
          ),
        ).then(votes => {
          const v = (votes || []).filter(Boolean);
          const blocking = v.flatMap(r =>
            (r.bugs || []).filter(b => ["ub", "leak", "semantics", "abi", "build"].includes(b.severity)),
          );
          const accepted = v.length >= 2 && v.every(r => r.accept) && blocking.length === 0;
          return { ...h, accepted, review_blocking: blocking };
        })
      : { ...h, accepted: false },
);

const accepted = results.filter(r => r && r.accepted);
const rejected = results.filter(r => r && r.fix && r.fix.patch && !r.accepted);
const noBugs = results.filter(r => r && (!r.blocking || r.blocking.length === 0));

return {
  files: shard.files.length,
  no_bugs: noBugs.length,
  accepted: accepted.map(r => ({
    file: r.file,
    bugs: r.blocking.length,
    summary: r.fix.summary,
    files_edited: r.fix.files_edited,
    patch: r.fix.patch,
  })),
  rejected: rejected.map(r => ({ file: r.file, summary: r.fix?.summary, blocking: r.review_blocking })),
  hunted_only: results
    .filter(r => r && r.blocking?.length > 0 && !r.fix)
    .map(r => ({ file: r.file, bugs: r.blocking })),
};
