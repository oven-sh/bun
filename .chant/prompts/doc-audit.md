---
name: doc-audit
purpose: Audit Rust code against mdbook documentation
---

# Documentation Audit

You are auditing the documentation for {{project.name}}.

## Your Spec

**{{spec.title}}**

{{spec.description}}

## Audit Process

### 1. Read the Source Code

Read the Rust source file(s) specified in this spec carefully. Understand:
- Public API (functions, structs, enums, traits)
- Module-level documentation
- Key behaviors and edge cases
- Configuration options
- Error handling

### 2. Read the Related Documentation

Read the mdbook documentation pages that correspond to this source code.
Check the `docs/doc-audit-map.toml` file to find the mapping.

### 3. Compare and Document Discrepancies

Look for:
- **Missing documentation**: Features in code not mentioned in docs
- **Outdated documentation**: Docs describing old behavior or removed features
- **Incorrect documentation**: Docs that contradict actual code behavior
- **Missing examples**: Code patterns without usage examples
- **Missing warnings**: Edge cases or gotchas not documented

### 4. Update Audit Markers

After completing the audit, update both:

**A. Source docstring marker** (if it has `# Doc Audit` section):
```rust
//! # Doc Audit
//! - audited: YYYY-MM-DD  <- Update this date
//! - docs: reference/xxx.md
//! - ignore: false
```

**B. Tracking file** (`docs/doc-audit-map.toml`):
```toml
[mappings."src/xxx.rs"]
docs = ["reference/xxx.md"]
last_audit = "YYYY-MM-DD"  # <- Update or add this line
```

### 5. Create Follow-up Specs (if needed)

If you find documentation that needs updates:

```bash
just chant add "Update docs/reference/xxx.md to document new feature Y"
```

Do NOT fix documentation issues directly - create specs for them.

## Output Format

Provide a structured audit report:

```markdown
## Audit Report: src/xxx.rs

### Docs Reviewed
- docs/reference/xxx.md
- docs/concepts/yyy.md

### Findings

#### Accurate
- [x] Function `foo()` correctly documented
- [x] Configuration options match docs

#### Discrepancies Found
1. **Missing**: `bar()` function not documented
   - Action: Created spec 2026-XX-XX-XXX to add documentation
2. **Outdated**: Docs mention `--old-flag` which was removed
   - Action: Created spec 2026-XX-XX-XXX to update CLI reference

#### No Issues
- Error handling documentation is accurate
- Examples work as documented

### Summary
- Total items checked: X
- Accurate: Y
- Discrepancies: Z
- Follow-up specs created: N
```

## Constraints

- Only audit, do not fix documentation in this spec
- Create separate specs for any documentation fixes needed
- Update audit timestamps only after completing the full audit
- If source code has changed significantly, note that a deeper audit may be needed
- Always verify code behavior before marking docs as "accurate"

## Acceptance Criteria

- [ ] Source file fully reviewed
- [ ] Related doc pages fully reviewed
- [ ] All discrepancies documented
- [ ] Follow-up specs created for fixes
- [ ] Audit timestamp updated in docstring
- [ ] Audit timestamp updated in tracking file
- [ ] Commit with message: `chant({{spec.id}}): audit docs for <module>`
