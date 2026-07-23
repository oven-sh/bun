#!/usr/bin/env bun
// Reconstructs fix-round workflow output from a (possibly killed) run's
// transcript dir + journal. Maps each agent to its role/file via the prompt
// label embedded in the first user message, then re-applies the merge logic.
//
// Usage: bun harvest.ts <workflow-dir>  > result.json
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("Usage: bun harvest.ts <workflow-dir>\n");
  process.exit(1);
}
// Tolerate truncated/partial lines (e.g. from a killed run).
const journal = readFileSync(join(dir, "journal.jsonl"), "utf8")
  .split("\n")
  .filter(l => l.startsWith("{"))
  .flatMap(l => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });

const results = new Map<string, any>();
for (const e of journal) if (e.type === "result") results.set(e.agentId, e.result);

type Role = "fix" | "rev1" | "rev2";
const byFile = new Map<string, Partial<Record<Role, any>>>();

for (const f of readdirSync(dir)) {
  const m = f.match(/^agent-([a-f0-9]+)\.jsonl$/);
  if (!m) continue;
  const agentId = m[1];
  const first = readFileSync(join(dir, f), "utf8").split("\n", 1)[0];
  if (!first) continue;
  let prompt: string;
  try {
    const msg = JSON.parse(first);
    const content = msg.message?.content;
    prompt = typeof content === "string" ? content : (content?.[0]?.text ?? content?.[0]?.content ?? "");
  } catch {
    continue;
  }
  // The prompt starts with either:
  //   "Fix the clippy errors in `<file>` ..."
  //   "Adversarially review this clippy-fix diff for `<file>` ..."
  const fileMatch = prompt.match(/`((?:src|test)\/[^`]+\.rs)`/);
  if (!fileMatch) continue;
  const file = fileMatch[1];
  let role: Role;
  if (prompt.startsWith("Fix the clippy errors")) role = "fix";
  else if (prompt.startsWith("Adversarially review")) {
    // rev1/rev2 share the same prompt; use arrival order
    const slot = byFile.get(file);
    role = slot?.rev1 === undefined ? "rev1" : "rev2";
  } else continue;
  const slot = byFile.get(file) ?? {};
  slot[role] = results.get(agentId) ?? null;
  byFile.set(file, slot);
}

const out = [];
for (const [file, s] of byFile) {
  const fix = s.fix;
  if (!fix || !fix.patch?.trim()) {
    out.push({ file, approved: false, patch: "", reviewNotes: fix?.summary ?? "fixer produced no patch" });
    continue;
  }
  const v1 = s.rev1 ?? { approved: false, notes: "rev1 missing" };
  const v2 = s.rev2 ?? { approved: false, notes: "rev2 missing" };
  if (v1.approved && v2.approved) {
    out.push({ file, approved: true, patch: fix.patch, reviewNotes: "2/2 approved" });
  } else {
    out.push({
      file,
      approved: false,
      patch: "",
      reviewNotes:
        (v1.approved ? "r1:ok" : `r1:REJECT ${v1.notes}`) + " | " + (v2.approved ? "r2:ok" : `r2:REJECT ${v2.notes}`),
    });
  }
}

process.stderr.write(
  `harvested ${out.length} files: approved=${out.filter(o => o.approved).length} rejected=${out.filter(o => !o.approved).length}\n`,
);
process.stdout.write(JSON.stringify(out) + "\n");
