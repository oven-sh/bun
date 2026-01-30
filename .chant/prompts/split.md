---
name: split
purpose: Split a driver spec into members with detailed acceptance criteria
---

# Split Driver Specification into Member Specs

You are analyzing a driver specification for the {{project.name}} project and proposing how to split it into smaller, ordered member specs.

**IMPORTANT: This is an analysis task. Do NOT use any tools, do NOT explore the codebase, do NOT make any changes, do NOT commit anything. ONLY output text in the exact format specified below.**

## Driver Specification to Split

**ID:** {{spec.id}}
**Title:** {{spec.title}}

{{spec.description}}

## Your Task

1. Analyze the specification and its acceptance criteria
2. Propose a sequence of member specs where:
   - Each member leaves code in a compilable state
   - Each member is independently testable and valuable
   - Dependencies are minimized (parallelize where possible)
   - Common patterns are respected (add new alongside old → update callers → remove old)
3. For each member, provide:
   - A clear, concise title
   - Description of what should be implemented
   - Explicit acceptance criteria with checkboxes for verification
   - Edge cases that should be considered
   - Example test cases where applicable
   - List of affected files (if identifiable from the spec)
   - Clear "done" conditions that can be verified

## Complexity Thresholds (Linting-Aware)

Each resulting member spec should meet these thresholds to pass linting:
- **Acceptance Criteria:** ≤ 5 items (allows haiku to verify completion)
- **Target Files:** ≤ 5 files (keeps scope focused, minimal coupling)
- **Description Length:** ≤ 200 words (haiku-friendly, clear intent)

These thresholds ensure the split produces specs that are:
- **Independently executable** by Claude Haiku
- **Verifiable** with clear, specific acceptance criteria
- **Self-contained** without cross-references

## Why Thorough Acceptance Criteria?

These member specs will be executed by Claude Haiku, a capable but smaller model. A strong model (Opus/Sonnet) doing the split should think through edge cases and requirements thoroughly. Each member must have:

- **Specific checkboxes** for each piece of work (not just "implement it")
- **Edge case callouts** to prevent oversights
- **Test scenarios** to clarify expected behavior
- **Clear success metrics** so Haiku knows when it's done
- **Within complexity thresholds** so the spec stays manageable for haiku

This way, Haiku has a detailed specification to follow and won't miss important aspects.

## Preventing Cross-References

Resulting member specs must be independent and not reference each other:
- **No spec ID cross-references** in member descriptions (no mentions of `.1`, `.2`, etc.)
- **Separate target_files** whenever possible (avoid coupling through shared files)
- **Each spec self-contained** with clear acceptance criteria (no implicit dependencies beyond the dependency chain)

This ensures members can be executed in parallel where dependencies allow.

## Output Format

**CRITICAL: Output ONLY the member specs in EXACTLY this format. No preamble, no summary, no tool use.**

Start your output directly with `## Member 1:` and continue with each member.

```
## Member 1: <title>

<description of what this member accomplishes>

### Acceptance Criteria

- [ ] Specific criterion 1
- [ ] Specific criterion 2
- [ ] Specific criterion 3

### Edge Cases

- Edge case 1: Describe what should happen and how to test it
- Edge case 2: Describe what should happen and how to test it

### Example Test Cases

For this feature, verify:
- Case 1: Input X should produce Y
- Case 2: Input A should produce B

**Affected Files:**
- file1.rs
- file2.rs

## Member 2: <title>

... (continue with same format)
```

If no files are identified, you can omit the Affected Files section.

Create as many members as needed (typically 3-7 for a medium spec).

**Remember: Output ONLY the `## Member N:` sections. No introduction, no summary, no "I will create..." statements.**
