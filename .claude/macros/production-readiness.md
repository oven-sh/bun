---
description: Get code ready for production / merge / PR
Includes a code review performed adversarially as a Senior Architect / Engineer
---

# Data
macros/shortcuts are stored in {ai-directives}/macros/*.md
## Variables used below
{superpowers} = {ai-directives}/skills/using-superpowers.md
{production-review} = review-production-readiness.md
{this-macro} = {commands}/production-readiness.md
{commit-announcement} = "# Production readiness fixes committed as {7-hex-commit-hash} {commit title here}\n\n"
{date-format} is the output from `date -Is`, which produces a date like: 2026-04-27T17:55:22+07:00 (in the local TZ)

# CRITICAL: Mandatory State Machine

The review MUST pass through these states in exact order. You MUST NOT skip states, merge states, or proceed from one state to the next without providing the required proof. You MUST NOT produce a verdict before completing all states.

```
CONTEXT_LOADED → BAR_DEFINED → DIFF_REVIEWED → ARTEFACT_WRITTEN → ARTEFACT_VERIFIED → VERDICT_RENDERED
```

## State 0 — CONTEXT_LOADED

Load the minimum sufficient context per Phase 0 of {production-review}.

**Proof required:** List every file you read and the specific line ranges / sections consulted for the review. Format:
```
- {path}:{start}-{end} (why: {purpose})
```
You MUST NOT proceed to State 1 until you have listed all context files.

## State 1 — BAR_DEFINED

Define the production bar per Phase 1 of {production-review}.

**Proof required:** The "# Production-ready bar for this PR" section exists in your review text with exactly 5-10 bullets grounded in repo docs. Say "Bar defined: N bullets" where N is the count.

## State 2 — DIFF_REVIEWED

Review the diff per Phase 2 of {production-review}. Execute Phase 3 (adversarial review) as part of this state.

**Proof required:** Every finding has evidence with `path:line`. Every finding is classified as BLOCKING/NON-BLOCKING/NIT. Say "Review complete: N findings (B blocking, NB non-blocking, X nits)."

## State 3 — ARTEFACT_WRITTEN

**CRITICAL: The review output, including the final verdict, MUST be written to disk BEFORE it can be mentioned in chat.**

Write the complete review output to `{projectRoot}/REVIEW-{date-format}.md`. The file must contain every required section heading from {production-review}'s OUTPUT FORMAT section, plus all findings with evidence.

**Proof required:** Say "Wrote REVIEW-{date-format}.md: {N} lines, {absolute-path}."

You MUST NOT speak the verdict in chat at this state. The verdict must be written to the file first, confirmed by readback in State 4, and only then may it appear in chat as State 5.

## State 4 — ARTEFACT_VERIFIED

**CRITICAL: You MUST read the file back from disk using a Read tool call.** Do NOT trust your memory of what you wrote. Do NOT claim verification without physically re-reading the file.

Read `{projectRoot}/REVIEW-{date-format}.md`.

Confirm ALL of the following:
- [ ] `# Production-ready bar for this PR` heading is present and has 5-10 bullets
- [ ] `# Findings` heading is present
- [ ] `## 1. Correctness & functional completeness` heading is present
- [ ] `## 2. Architecture & boundary integrity` heading is present
- [ ] `## 3. Code clarity, clean code & maintainability` heading is present
- [ ] `## 4. Comments & code documentation` heading is present
- [ ] `## 5. Tests & validation` heading is present
- [ ] `## 6. Performance` heading is present
- [ ] `## 7. Operational risk` heading is present
- [ ] `## 8. Adversarial review` heading is present
- [ ] `# What I could not fully verify` heading is present
- [ ] `# Final verdict` heading is present and contains exactly one of:
  - `✅ Ready to merge — no blocking issues.`
  - `⚠️ Merge after addressing blocking items.`
  - `❌ Not ready — fundamental concerns.`
- [ ] Every finding has: classification (BLOCKING/NON-BLOCKING/NIT), type (Verified issue/Plausible risk/Unverified concern), evidence with `path:line`, confidence (High/Medium/Low)

**Proof required:** Say "Verified: all {N} required headings present, verdict = {verdict-text}."

### Branch: HEADINGS MISSING

If ANY required heading is missing, or any finding is incomplete (missing classification, type, evidence, or confidence):

1. Say "Missing: {exactly what is missing}."
2. Fix the file.
3. Re-read the file.
4. Re-verify all headings.
5. Repeat until ALL headings are present and ALL findings are complete.

You MUST NOT proceed to State 5 until the verification checklist above is 100% satisfied.

### Branch: STALE CONTENT

If the file contains outdated information (e.g., references to mechanisms that were changed during review, old test approaches no longer used):

1. Say "Stale: {what is stale and where}."
2. Fix the file.
3. Re-read and re-verify.
4. Repeat until all content is current.

## State 5 — VERDICT RENDERED

The verdict was already written to the REVIEW-*.md file in State 3 and verified in State 4.

Now you may report the verdict in chat. Copy it from the verified file — do not compose a new verdict from memory.

**Proof required:** Say the verdict text, followed by "{N} findings in REVIEW-{date-format}.md."

# Required steps (mandatory, in order)

## Code review — Gated Loop

For each step of this loop, say out loud what state you are in before you provide its proof. Keep yourself honest.

### Begin loop:
1. Execute the {production-review} macro / command.
2. Walk through States 0-5 above. You MUST complete each state before starting the next.
3. Carefully analyze every finding and fix ALL issues (including all nits).
4. Say if the review you just did produced any code changes.
5. Branch Yes/No: Were there ANY code changes made at all from the review?
   - No
     - Say "I made no code changes — none needed to be made."
   - Yes
     - Commit your changes with an appropriate title.
       - Ensure the commit is ONLY the required changes — no AGENTS.md changes, no build files, no unrelated refactors.
       - Use {superpowers} for assistance with removing build artifacts if not already done.
       - Use {commit-announcement} format to announce the commit you just made.
     - Say: "Changes committed. I must now re-run the production-readiness macro again before halting."
     - Restart from State 0 (begin of loop) — DO NOT skip this restart.
----- End loop ------
Do the loop again if you made ANY changes on the last round.

## User presentation — checklist / do-list
- Check again if you made any changes based on the last review — mandatory restart of the gated loop if so.
- Say "No changes from the {#n}th review pass\n\n", where n is the number of reviews you did.
- Say "## Commits made:\n"
  - List all the commits you made in the 1-{#n-1} passes in {commit-announcement} format
- Say "## Summary of issues fixed:"
  - List each one:
    - "- {approx 9 word summary}\n"
    - "  - "{approx 25 words of detail}\n"
  - "\n\n"
- Say "## Outstanding or pre-existing issues or things not possible to check:\n\n"
  - Use same format as Summary of issues fixed.
- Show the `## Final verdict` section from the final review conducted.
- Show the full pathnames to each of the REVIEW-*.md files created.

----------------------------------------
You are only complete if you've completed the user presentation in the format specified above.

----------------------------------------

Additional user context may or may not follow. <END OF MACRO / COMMAND>

----------------------------------------
