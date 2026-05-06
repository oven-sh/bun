export const meta = {
  name: "phase-b2-fill-blocked",
  description: "Track A round 10: per-crate, add the missing symbols that T2-T6 reported blocked_on",
  phases: [{ title: "Fill", detail: "one agent per target crate" }],
};
const REPO = "/root/bun-5";
const CRATES = (args && args.crates) || []; // [{name, symbols:[...]}]
if (!CRATES.length) return { error: "no crates" };

const SCHEMA = {
  type: "object",
  required: ["symbols_added", "files_edited"],
  properties: {
    symbols_added: { type: "integer" },
    files_edited: { type: "array", items: { type: "string" }, description: "relative to src/<crate>/" },
    skipped: { type: "array", items: { type: "string" } },
    notes: { type: "string" },
  },
};

phase("Fill");
const results = await pipeline(CRATES, c =>
  agent(
    `B-2 Track A: add ${c.symbols.length} missing symbols to crate **${c.name}** so dependents stop being blocked.

**Symbols to add (pub-exported from the crate):**
${c.symbols.map(s => "- `" + s + "`").join("\n")}

**How to find ground truth per symbol:**
- *_sys crates (boringssl_sys, libarchive_sys, etc.): add \`unsafe extern "C" { fn X(...) -> ...; }\` decl. Read the .zig FFI block (\`src/${c.name}/*.zig\`) or vendor C header for the signature. Opaque struct types → \`#[repr(C)] pub struct X { _p: [u8;0], _m: PhantomData<(*mut u8, PhantomPinned)> }\`.
- bun_jsc::JSValue::*/JSGlobalObject::*/etc.: add the method to the impl block in the matching .rs (JSValue.rs, JSGlobalObject.rs) wrapping \`extern "C" JSC__<Type>__<method>\`. Read \`src/jsc/<Type>.zig\` for the Zig wrapper sig + \`src/jsc/bindings/headers.h\` (grep for the C symbol) for the ABI.
- bun_sys::*: add libc syscall wrapper to \`src/sys/lib.rs\` (same pattern as the 59 already there: check!/check_p! macro, EINTR-retry, MAX_COUNT clamp). Read \`src/sys/sys.zig\`.
- bun_collections::* methods: implement on existing ArrayHashMap/StringArrayHashMap structs. Read the .zig.
- bun_core::*: small helpers — csprng (getrandom syscall), Once=std::sync::Once alias, fast_random, getcwd, self_exe_path, which, Ordinal, Timespec.
- Higher-tier (install/css/js_parser/bundler/resolver/sourcemap/runtime): un-gate the specific impl block or struct that defines the symbol; if it's a type from a still-gated mega-module (e.g. js_parser::ast 43kL), add a minimal real def to the crate's stub module.

**Loop:** add a batch of ~10 symbols → \`cargo check -p bun_${c.name.replace(/^bun_/, "")}\` → fix → next batch. Cap 30 cargo rounds. If a symbol can't be added without editing ANOTHER crate or needs nightly: push to \`skipped\` with reason.

**HARD RULES:** edit ONLY \`${REPO}/src/${c.name}/\`. NEVER git. NEVER touch .zig. NEVER Box::leak/mem::forget/transmute-lifetime (PORTING.md §Forbidden). Read .zig/.h for truth; don't guess signatures. List every .rs you edited in files_edited.`,
    { label: `fill:${c.name}`, phase: "Fill", schema: SCHEMA },
  ).then(r => ({ crate: c.name, ...(r || { symbols_added: 0, files_edited: [], skipped: ["agent-null"] }) })),
);

return {
  crates: CRATES.length,
  total_symbols_added: results.reduce((a, r) => a + r.symbols_added, 0),
  modules: results.flatMap(r =>
    r.files_edited.map(f => ({ crate: r.crate, file: f, zig: `src/${r.crate}/${f.replace(/\.rs$/, ".zig")}` })),
  ),
  skipped: results.flatMap(r => (r.skipped || []).map(s => `${r.crate}: ${s}`)),
  results,
};
