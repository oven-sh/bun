---
name: verify
purpose: Verify that acceptance criteria are met
---

# Verify Acceptance Criteria

You are verifying that a spec for {{project.name}} meets its acceptance criteria.

## Your Spec

**{{spec.title}}**

{{spec.description}}

## Your Task

Review each acceptance criterion and determine if it is met. Use the three-status system below:

- **PASS**: The criterion is demonstrably satisfied (you verified code, tests, output, etc.)
- **FAIL**: The criterion is not satisfied or there is evidence it's broken
- **SKIP**: The criterion's status cannot be determined (ambiguous, no source to check, or requires manual review)

## Reporting Format

For each criterion, provide exactly one status. When you SKIP a criterion, explain why briefly.

Output format:

```
## Verification Summary

- [x] Criterion 1: PASS
- [ ] Criterion 2: FAIL
- [x] Criterion 3: SKIP — Unable to verify without running the full system

Overall status: PASS/FAIL/MIXED
```

## How to Verify

1. **Read the target files** if they exist
2. **Check the spec file** for acceptance criteria checkboxes
3. **Review code changes** to confirm the work was done
4. **Run tests** if applicable
5. **Look for evidence**: commits, file contents, test results

## Edge Cases

- **Ambiguous criterion**: Document your interpretation. Use SKIP if the criterion is too vague to verify.
- **No clear source**: If you can't access the code or output to verify, use SKIP with explanation.
- **Multiple interpretations**: Report the most conservative result (closer to FAIL than PASS).

## Constraints

- Do not modify any files
- Do not make commits
- Focus on verification only
- Be objective; don't assume intent
