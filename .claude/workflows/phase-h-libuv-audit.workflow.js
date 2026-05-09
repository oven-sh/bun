export const meta = {
  name: "phase-h-libuv-audit",
  description:
    "Targeted reliability audit of libuv integration. Find all uv handle ownership paths → 2-vote review each for Box-drop/async-close/callback-reclaim UB → bugfix → compile.",
  phases: [
    { title: "Survey", detail: "find every uv handle alloc/close/callback site" },
    { title: "Audit", detail: "2-vote per file: trace ownership paths for the known bug class" },
    { title: "Fix", detail: "apply UB/leak/semantics findings" },
    { title: "Compile", detail: "5-target clean-leaf + commit" },
  ],
};

const A = typeof args === "string" ? JSON.parse(args) : args || {};
const WT = A.worktree || "/root/bun-5-libuv-audit";

const SURVEY_S = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          handles: { type: "array", items: { type: "string" } },
          alloc_sites: { type: "number" },
          close_sites: { type: "number" },
          callback_sites: { type: "number" },
          box_uv: { type: "number" },
        },
        required: ["file"],
      },
    },
    handle_types: { type: "array", items: { type: "string" } },
  },
  required: ["files", "handle_types"],
};
const AUDIT_S = {
  type: "object",
  properties: {
    file: { type: "string" },
    paths_traced: { type: "number" },
    bugs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "number" },
          handle_type: { type: "string" },
          what: { type: "string" },
          why_wrong: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string", enum: ["ub", "leak", "semantics", "race", "style"] },
        },
        required: ["what", "why_wrong", "severity"],
      },
    },
  },
  required: ["file", "paths_traced", "bugs"],
};
const FIX_S = {
  type: "object",
  properties: { file: { type: "string" }, applied: { type: "number" }, notes: { type: "string" } },
  required: ["file", "applied"],
};
const COMPILE_S = {
  type: "object",
  properties: {
    rounds: { type: "number" },
    errors_after: { type: "number" },
    commit: { type: "string" },
    notes: { type: "string" },
  },
  required: ["errors_after"],
};

const NO_TOOLS = `**HARD RULES:** Work in ${WT}. **DO NOT** run cargo/git/bun (until Compile phase). Read/Grep/Glob OK.`;

// ─── Phase 1: Survey ─────────────────────────────────────────────────────────
phase("Survey");
const survey = await agent(
  `Survey ALL libuv handle ownership sites. Repo ${WT}. READ ONLY.

1. List uv handle types: \`grep -rn 'pub struct uv_\\|type uv_.*_t\\|struct.*: UvHandle' ${WT}/src/libuv_sys/ ${WT}/src/io/\` — Pipe, Timer, Process, fs_event, tty, tcp, udp, signal, poll, async, idle, prepare, check, etc.
2. For each file in \`grep -rln 'uv::\\|uv_\\|UvHandle\\|libuv' ${WT}/src/ --include='*.rs' | grep -v 'libuv_sys/'\`:
   - Count alloc sites: \`Box::new(.*uv::\`, \`heap::into_raw(.*uv::\`, \`zeroed::<uv::\`
   - Count close sites: \`.close(\`, \`uv_close\`
   - Count callback sites: \`extern "C" fn.*uv_\`, \`on_.*close\`, \`heap::take(\`, \`Box::from_raw(\`
   - Count Box<uv::*> fields: \`Box<uv::\`, \`Option<Box<uv::\`
3. Skip files with 0 of all four (false-positive grep on \`uv\` substring).

${NO_TOOLS}

Return {files:[{file,handles,alloc_sites,close_sites,callback_sites,box_uv}], handle_types:[...]}.`,
  { label: "survey", phase: "Survey", schema: SURVEY_S },
);
if (!survey || !survey.files.length) return { error: "no files" };
const files = survey.files.filter(
  f => (f.alloc_sites || 0) + (f.close_sites || 0) + (f.callback_sites || 0) + (f.box_uv || 0) > 0,
);
log(`survey: ${files.length} files with uv handle ownership, types: ${(survey.handle_types || []).join(",")}`);

// ─── Phase 2: Audit (2-vote per file) ────────────────────────────────────────
phase("Audit");
const BUG_CLASS = `
**Known bug classes (the Zig *uv.Handle → Rust Box<uv::Handle> mismatch):**

1. **Box drops before async close completes**: \`let pipe: Box<uv::Pipe> = ...; pipe.close(on_close);\` — Box drops at scope-end, libuv calls \`on_close\` later on freed memory. FIX: \`Box::leak(pipe).close(on_close)\` and \`on_close\` reclaims via \`heap::take\`/\`Box::from_raw\`.
2. **Double Box::from_raw**: \`spawn_process_windows\` already moved ownership into result, but caller \`heap::take\`'s the dangling ptr in options → 2 Box owners. FIX: take from result, not options.
3. **Option<Box<Handle>> = None drops while alias live**: e.g. WindowsNamedPipe \`self.pipe = None\` frees Box but a Source/NonNull alias still points there. FIX: store NonNull alias OR transfer ownership before nulling.
4. **&mut self held across uv callback**: handle's callback fires re-entrantly while \`&mut self\` is live → aliased &mut UB.
5. **Handle init on moved Box**: \`let mut h = Box::new(zeroed()); h.init(loop)\` then move \`h\` — libuv stored the OLD address in its loop queue. FIX: init AFTER final placement (or pin).
6. **Missing close**: handle allocated but no \`uv_close\` path → libuv loop never drains, leak + hang.
7. **Close callback never reclaims**: \`Box::leak\` then close callback is no-op → leak.
8. **Thread-safety**: \`uv_async_send\` is the ONLY thread-safe call; any other uv call from non-loop thread is UB.

**For EACH ownership path** (alloc → use → close → callback), trace and verify it avoids ALL 8.
`;

const audited = await pipeline(
  files,
  f =>
    parallel(
      [0, 1].map(
        i => () =>
          agent(
            `Audit libuv ownership in **${f.file}**. Repo ${WT}. Handles: ${(f.handles || []).join(",") || "(infer)"}. Sites: alloc=${f.alloc_sites} close=${f.close_sites} callback=${f.callback_sites} Box<uv>=${f.box_uv}.

${BUG_CLASS}

**Process:**
1. Read ${f.file} fully + .zig spec at same path.
2. For EACH uv handle in this file, trace its lifecycle: where allocated? owned by what (Box/Option<Box>/NonNull/raw *mut)? when closed? what callback reclaims? where dropped?
3. For each path, check the 8 bug classes. Cite line numbers.
4. Also check: any \`mem::zeroed::<uv::*>()\` on a type with non-zero invariants? any \`uv_*\` call after close?

DEFAULT: no bugs (most paths are correct after the prior fix round). Only report HIGH-CONFIDENCE issues with specific line+why.

${NO_TOOLS}

Return {file:"${f.file}", paths_traced:N, bugs:[{line,handle_type,what,why_wrong,fix,severity}]}.`,
            { label: `aud${i}:${f.file.split("/").pop()}`, phase: "Audit", schema: AUDIT_S },
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
          `Apply libuv ownership fixes to **${f.file}**. Repo ${WT}.

**${vr.blocking.length} BLOCKING findings:**
${vr.blocking.map((b, i) => `${i + 1}. [${b.severity}] L${b.line || "?"} (${b.handle_type || ""}): ${b.what}\n   WHY: ${b.why_wrong}\n   FIX: ${b.fix}`).join("\n")}

Edit ${f.file}. Read .zig spec. Match the canonical patterns: \`Box::leak\` before async close, \`heap::take\` ONLY in close callback, NonNull for non-owning aliases, init after final placement.

${NO_TOOLS} (Edit OK, NO cargo/git)

Return {file:"${f.file}", applied:N, notes}.`,
          { label: `fix:${f.file.split("/").pop()}`, phase: "Fix", schema: FIX_S },
        ).then(a => ({ ...vr, fix: a }))
      : vr,
);

const allBugs = audited.filter(Boolean).flatMap(r => (r.bugs || []).map(b => ({ file: r.file, ...b })));
const allBlocking = allBugs.filter(b => ["ub", "leak", "semantics", "race"].includes(b.severity));

// ─── Phase 4: Compile ────────────────────────────────────────────────────────
phase("Compile");
const compile = await agent(
  `FINAL: compile + commit libuv audit fixes. Repo ${WT}. **You may use cargo/git.**

${audited.filter(r => r && r.fix).length} files fixed. Blocking findings applied: ${allBlocking.length}.

**Process:**
1. \`cd ${WT} && cargo check --workspace --keep-going 2>&1 | grep -cE '^error\\['\` — fix any (loop ≤6 rounds).
2. **5-target clean-leaf**: \`for t in x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-unknown-freebsd aarch64-linux-android x86_64-unknown-linux-musl; do cargo clean -p bun_runtime -p bun_bin --target $t 2>/dev/null; cargo check -p bun_bin --target $t 2>&1 | grep -cE '^error\\['; done\` — fix any non-zero.
3. \`cd ${WT} && bun bd --version\` exit 0 + \`bun bd test test/js/bun/util/inspect.test.js\` 72/0.
4. \`cd ${WT} && git -c core.hooksPath=/dev/null add -A 'src/' && git -c core.hooksPath=/dev/null commit -q -m "phase-h: libuv reliability audit (${allBlocking.length} fixes across ${audited.filter(r => r && r.fix).length} files)"\`. NO push.

Return {rounds, errors_after, commit, notes}.`,
  { label: "compile-fix-commit", phase: "Compile", schema: COMPILE_S },
);

return {
  files_audited: files.length,
  handle_types: survey.handle_types,
  total_bugs: allBugs.length,
  blocking: allBlocking,
  by_severity: {
    ub: allBugs.filter(b => b.severity === "ub").length,
    leak: allBugs.filter(b => b.severity === "leak").length,
    race: allBugs.filter(b => b.severity === "race").length,
    semantics: allBugs.filter(b => b.severity === "semantics").length,
    style: allBugs.filter(b => b.severity === "style").length,
  },
  files_fixed: audited.filter(r => r && r.fix).length,
  compile,
};
