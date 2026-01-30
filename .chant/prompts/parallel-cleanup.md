# Parallel Execution Cleanup

You are analyzing the results of a parallel chant execution and helping resolve any issues that occurred.

## Context

Multiple specs were executed in parallel using different Claude agents. This can cause:
- API concurrency/rate limit errors
- Merge conflicts between branches
- Partial failures (some specs succeeded, others failed)
- Stale worktrees that weren't cleaned up
- Dependency violations (if specs should have been ordered)

## Your Task

1. **Analyze the execution results** - Review what succeeded and what failed
2. **Identify root causes** - Determine why failures occurred
3. **Suggest resolution order** - Which issues to fix first
4. **Handle merge conflicts** - Determine which branch has the correct changes
5. **Clean up stale state** - Remove worktrees and branches that are no longer needed

## Common Pitfalls and Solutions

### API Concurrency Errors (429, rate limit)

These are retryable. Solutions:
- Reduce `max_concurrent` for individual agents
- Use `--max N` flag to limit parallel execution
- Retry failed specs after successful ones complete

### Merge Conflicts

When two specs modify the same files:
1. Check which spec should take priority (earlier spec ID usually first)
2. Examine both branches to understand the changes
3. Create a resolution strategy:
   - If changes are compatible: merge manually
   - If changes conflict: pick the more complete/correct one
   - If both are needed: combine them carefully

### Partial Failures

When some specs succeed but others fail:
1. Prioritize fixing critical failures (merge conflicts, broken tests)
2. Retry transient failures (API errors)
3. Consider if failed specs have dependencies on successful ones

### Stale Worktrees

Worktrees that weren't cleaned up:
1. Check if the worktree has uncommitted changes
2. If clean: remove with `git worktree remove <path>`
3. If dirty: review changes and commit/discard appropriately

### Dependency Violations

If specs that should run sequentially ran in parallel:
1. Check for conflicts in target files
2. Determine correct merge order
3. Create conflict resolution spec if needed

## Cleanup Commands

```bash
# List all worktrees
git worktree list

# Remove a worktree
git worktree remove <path>

# List stale branches
git branch --list 'spec/*'

# Delete a branch
git branch -d <branch-name>

# Check for merge conflicts
git status

# Abort a failed merge
git merge --abort
```

## Output Format

Provide a structured analysis:

1. **Summary**: High-level overview of what happened
2. **Issues Found**: List each issue with severity
3. **Recommended Actions**: Ordered list of steps to take
4. **Manual Review Required**: Any decisions that need human input

Be specific about file paths, branch names, and spec IDs when describing issues and solutions.
