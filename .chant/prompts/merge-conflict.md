# Resolve Merge Conflict

You are resolving a git conflict during a rebase operation.

## Conflict Context
- Branch being rebased: {{branch_name}}
- Rebasing onto: {{target_branch}}
- Conflicting files: {{conflicting_files}}

## Current Conflict Diff
{{conflict_diff}}

## Instructions

1. **Read** each conflicting file to see the full conflict markers:
   - `<<<<<<< HEAD` marks the start of the target branch version
   - `=======` separates the two versions
   - `>>>>>>> commit` marks the end of the incoming branch version

2. **Analyze** the conflict to determine the correct resolution:
   - **Additive conflicts**: Both sides added different code - usually include both additions
   - **Modification conflicts**: Same code modified differently - choose the better version or combine
   - **Spec file conflicts**: Merge frontmatter fields from both sides, keep full content

3. **Edit** the files to resolve conflicts:
   - Remove all conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
   - Ensure the resolved code is syntactically correct
   - Preserve all functionality from both sides when possible

4. **Stage** each resolved file:
   ```bash
   git add <filename>
   ```

5. **Continue** the rebase when all conflicts are resolved:
   ```bash
   git rebase --continue
   ```

## Common Patterns

### Spec Frontmatter Conflicts
When spec files conflict, merge the YAML frontmatter fields:
- Keep `type`, `status` from either (usually the same)
- Merge `labels` arrays (include all unique labels)
- Keep `model`, `completed_at` from the completed version
- Keep `target_files` list

### Code Conflicts
When source code conflicts:
- For new function/struct additions: include both
- For import conflicts: include all unique imports
- For enum variant additions: include all variants in logical order
- For match arm additions: include all arms

## Important Notes

- Do NOT run `git commit` - the rebase process handles commits
- Do NOT skip (`git rebase --skip`) unless the entire commit is invalid
- If resolution is too complex, abort with `git rebase --abort` and report the issue
