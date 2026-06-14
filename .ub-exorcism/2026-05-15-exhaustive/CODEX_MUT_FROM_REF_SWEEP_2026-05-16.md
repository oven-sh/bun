# Codex `&self -> &mut` Sweep — 2026-05-16

The late spot check suggested a wider version of the EXP-057 / EXP-079 /
EXP-083 / EXP-084 family: safe methods that mint mutable references from shared
receivers. This sweep searched current `src/**/*.rs` for `&self -> &mut` shapes.

## Raw Count

`rg` found **70 textual hits**. This is a candidate set, not 70 bugs.

A later stricter signature pass found **37 direct safe `pub fn ...(&self) -> &mut ...`
signatures** (excluding `unsafe fn` and most multiline/macro noise). That pass
promoted one previously under-demoted row:

- **EXP-087 / F-L-6** — `src/bundler/ThreadPool.rs:414-428` returns
  `&'static mut Worker` from `get_worker(&self, id)`. The `Guarded` map lock
  serializes lookup, but it does not guard the lifetime of the returned
  reference; safe callers can call the method twice for the same `ThreadId` and
  hold two live `&mut Worker`s. Miri Tree Borrows confirms the duplicate-handle
  shape (`phase5_experiment_results/EXP-087.log`).

Important split:

- **Already confirmed by registry:** EXP-057, EXP-079, EXP-083, EXP-084, EXP-058
  adjacent wrappers, EXP-045/`JsCell`, EXP-010/LinkerContext, and several
  callback/re-entry rows.
- **Honest unsafe boundary:** functions already marked `unsafe fn` such as
  `JSCell::get_mut`, `BackRef::get_mut`-like helpers, `platform_event_loop`,
  `file_polls`, `symbol_mut`, `pipe_read_buffer`, `WindowsNamedPipe::loop_`,
  and `JSTranspiler::transpiler_mut`.
- **Interior-mutability wrappers:** `Body`, `Request`, `Response`, `IOWriter`,
  `IOReader`, and JS/JSC wrapper types usually document an R-2
  single-JS-thread invariant. These are not automatically production UB, but
  any safe method in this group that can be called twice while both returned
  `&mut` references stay live is an unsafe safe-API boundary unless the method
  returns a guard/closure or is made `unsafe`.
- **Field-projection short-lifetime wrappers:** MySQL `Writer`/`Reader`,
  `hot_reloader::StringSet`, parser `Log` projections, and similar helpers are
  often private and source-disciplined. They still deserve lint coverage because
  their comments repeatedly say "callers must not hold two results live" — a
  condition Rust cannot enforce for a safe `&self` method.

## Representative Hits Worth Keeping in the Audit Queue

| Site | Current classification | Why not counted as a new EXP here |
|---|---|---|
| `src/parsers/json_lexer.rs:329` | R-2 safe-contract hazard | Private parser discipline; same two-call shape as EXP-057. Add to lint/remediation queue, not a fresh count. |
| `src/js_parser/p.rs:60,76,752`; `src/js_parser/lexer.rs:490` | R-2 safe-contract hazard | Comments explicitly say callers must not hold two `log()` results live. This is exactly the EXP-057 shape without caller-chosen `'a`. |
| `src/runtime/webcore/Body.rs:121`; `Request.rs:211,227,247,256`; `Response.rs:269,377,408` | R-2 `JsCell`/hive escape hatch | JS-thread-affine production discipline may hold, but safe double-call misuse is possible in principle. Should be addressed by a guard/closure API or `unsafe` boundary. |
| `src/sql_jsc/mysql/MySQLConnection.rs:1545,1594,1608` | Field-projection helper | Private, consumed synchronously by parser/writer wrappers; comments are strong. Keep as lint target rather than new finding. |
| `src/jsc/hot_reloader.rs:412` | Init-once single-writer discipline | Comment says only watcher thread reaches callers after publish. Good source discipline, but safe `&self -> &mut` still deserves lint exception. |
| `src/jsc/webcore_types.rs:1145` | `Store::data_mut(&self)` | Comment admits caller must ensure no other `&mut` is live. Same safe-contract shape; should be unsafe or guard-shaped if exposed outside the narrow JSC event-loop discipline. |
| `src/runtime/bake/DevServer.rs:137` | VM mutable projection | Covered conceptually by EXP-084's `VirtualMachine::get_mut` finding. Do not create a duplicate. |
| `src/runtime/shell/IOWriter.rs:251`; `IOReader.rs:98,104` | Confirmed family | Already covered by EXP-083; these are the internal accessors behind the safe public mutators. |

## Artifact Impact

No new EXP was added. Instead:

- EXP-057 remains the canonical two-call `&self -> &mut` witness.
- EXP-087 is the source-specific promotion for the `ThreadPool::get_worker`
  variant that returns `&'static mut Worker` from a locked raw-pointer map.
- EXP-079, EXP-083, and EXP-084 remain the concrete source-specific promotions
  for the most severe safe API surfaces.
- Remediation should add a **workspace lint** for safe `&self -> &mut` methods:
  default deny, with exceptions requiring one of:
  - method is `unsafe fn`;
  - return is guard/closure-scoped so a second mutable borrow cannot coexist;
  - receiver type is private and an inline SAFETY comment names the unique
    caller discipline plus a test/lint anchor.

## Why This Matters

The broad sweep is an audit-quality improvement because it prevents a misleading
story: EXP-057 is not a quirky 17-site caller-chosen-lifetime bug. It is one
instance of a broader Zig-port R-2 pattern. The correct report framing is:

> The project repeatedly uses safe `&self` receivers as a porting convenience
> for Zig `*T` mutation. Some uses are source-disciplined and defensible; the
> unsafe contract should still be made explicit with `unsafe fn`, guard APIs, or
> a lint-enforced exception list.
