export const meta = {
  name: "review-round",
  description: "Per-file PR review-comment fixer + 1-reviewer gate",
  phases: [
    { title: "Address", detail: "agent reads bot review comments and fixes the file" },
    { title: "Review", detail: "1 adversarial reviewer per file" },
  ],
};

const parsed = typeof args === "string" ? JSON.parse(args) : args;
const files = Array.isArray(parsed) ? parsed : parsed.files;
if (!Array.isArray(files)) throw new Error("args must yield an array of {file,count,diagPath}");

const VERDICT_SCHEMA = {
  type: "object",
  required: ["verdict", "notes"],
  properties: {
    verdict: { type: "string", enum: ["ok", "revert", "fix-needed", "skipped"] },
    notes: { type: "string" },
  },
  additionalProperties: false,
};

const ADDRESS_SCHEMA = {
  type: "object",
  required: ["status", "summary"],
  properties: {
    status: { type: "string", enum: ["fixed", "skipped", "partial"] },
    summary: { type: "string" },
    skipped: {
      type: "array",
      items: { type: "string" },
      description: "Comments intentionally NOT acted on, with one-line reason each.",
    },
  },
  additionalProperties: false,
};

const FIXER = `
You are addressing bot review comments on a Bun PR (repo at /root/bun-5).

FIRST: Read the comment dump at the diagPath (one entry per comment, with the bot's reasoning).
THEN: Read the current file. The comments may reference an OLD commit — verify each finding is STILL present before fixing.

For each comment:
- If the issue is already fixed (a later commit addressed it): note in \`skipped\`.
- If the bot is factually wrong (verify by reading the actual code): note in \`skipped\` with a one-line correction.
- If the bot is right and the fix is in-file: apply it via Edit.
- If the fix needs cross-file changes: apply them all (Grep for the identifier; you have full Edit access).
- If the bot suggests a refactor that's out-of-scope (architecture change, multi-crate API): note in \`skipped\` with rationale.

HARD RULES:
- Use Read, Grep, Edit, Bash (\`cargo check -p <crate> --message-format=short\` to verify; NO \`cargo build\`, NO \`bun bd\`). Do NOT use git.
- NEVER add \`#[allow(...)]\` to a deny-level lint without a one-line comment explaining why.
- NEVER box a value that lives in a bump arena (no Drop on free → leak).
- Match the file's existing style (comment density, naming, idiom).
- After editing, run \`cargo check -p <crate-containing-this-file> --message-format=short 2>&1 | grep ': error'\` and report.
`;

const REVIEWER = `
Adversarially review whether the bot review comments for this file were correctly addressed.
Use ONLY Read and Grep. No Bash/cargo/git/Edit.

Read the comment dump at the diagPath. Read the current file. For each comment:
- Was it addressed? Or correctly skipped with a stated reason?
- Did the fix introduce a new bug? (deleted code that's used elsewhere, broken signature, etc.)
- Did the fix box an arena-allocated type? (= LSan leak)

verdict: "ok" / "fix-needed" (something missed or fix is wrong, list what) / "skipped" (no action taken and that's correct).
`;

const results = await pipeline(
  files,
  f =>
    agent(
      `Address ${f.count} bot review comments on \`/root/bun-5/${f.file}\`.\n` +
        `Comments dump: \`${f.diagPath}\` — Read this first.\n\n` +
        FIXER,
      { label: `review:${f.file}`, phase: "Address", schema: ADDRESS_SCHEMA },
    ),
  async (edit, f) => {
    if (!edit) return { file: f.file, verdict: "skipped", notes: "fixer failed" };
    const review = await agent(
      `Review whether bot comments on \`/root/bun-5/${f.file}\` were addressed.\n` +
        `Comments dump: \`${f.diagPath}\`. Fixer's summary: ${edit.summary}\n` +
        `Fixer's skips: ${(edit.skipped || []).join(" | ")}\n\n` +
        REVIEWER,
      { label: `rev:${f.file}`, phase: "Review", schema: VERDICT_SCHEMA },
    );
    return { file: f.file, verdict: review?.verdict ?? "skipped", notes: review?.notes ?? "" };
  },
);

return results.filter(Boolean);
