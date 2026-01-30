---
name: standard
purpose: Default execution prompt
---

# Execute Spec

You are implementing a spec for {{project.name}}.

## Your Spec

**{{spec.title}}**

{{spec.description}}

## Instructions

1. **Read** the relevant code first
2. **Plan** your approach before coding
3. **Implement** the changes
4. **Run `cargo fmt`** to format the code
5. **Run `cargo clippy`** to fix any lint errors and warnings
6. **Run tests** with `just test` and fix any failures
7. **Verify** the implementation works and all acceptance criteria are met
8. **Check off** each acceptance criterion in `{{spec.path}}` by changing `- [ ]` to `- [x]`
9. **Commit** with message: `chant({{spec.id}}): <description>`
10. **Verify git status is clean** - ensure no uncommitted changes remain

## When You Notice Issues Outside Your Scope

If you encounter a problem that is NOT part of your current spec:

1. **Check if a spec already exists** by running: `just chant list`
   - Look for specs with similar titles or keywords related to the issue
   - Check the `.chant/archive/` directory for completed specs

2. **If no existing spec found, create one:**
   ```bash
   just chant add "Brief description of the issue"
   ```
   - This creates a new spec documenting the problem for future resolution

3. **Note in your output** that you've created a new spec with its ID

4. **Continue with your original assignment** - do NOT fix the out-of-scope issue
   - Focus on completing the current spec's acceptance criteria
   - The new spec can be tackled separately

**Examples:**
- If you find a typo in documentation while implementing a feature, create a spec: `just chant add "Fix typos in API documentation"`
- If you notice a performance issue in unrelated code, create a spec: `just chant add "Optimize database query in user service"`
- If you find a security concern, create a spec immediately: `just chant add "Address potential SQL injection in query builder"`

## Avoiding Duplicate Specs

Before creating a new spec for an issue:

1. **Search existing specs:** `just chant list`
   - Review titles and descriptions for similar work
   - Check if another spec addresses the same problem

2. **Check archived specs:** `ls .chant/archive/`
   - Browse completed or abandoned specs
   - Verify the issue wasn't already addressed

3. **If a similar spec exists:**
   - Do NOT create a duplicate
   - Reference the existing spec ID in your output instead
   - Example: "This issue is already tracked in spec 2026-01-20-abc-xyz"

4. **If genuinely new:**
   - Create the spec with a unique, descriptive title
   - Ensure it doesn't overlap with existing work

## Constraints

- Always use "just chant" if available otherwise use ./target/debug/chant
- Only modify files related to this spec
- Do not refactor unrelated code
- Always add model: {{spec.model}} to frontmatter after all acceptance criteria met
- Always ensure chant binary builds
- After encountering an unexpected error, create a new spec to fix it
