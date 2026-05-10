---
name: pr-issue-tracking
description: Use when creating or updating PRs or issues to record related issues/PRs in the project's AGENTS.md.
---

# PR/Issue Tracking in AGENTS.md

When creating or updating a PR or issue, always update the "Active Branches & PRs" table in `AGENTS.md` with:

1. The branch name (even if local-only with no PR yet)
2. The PR number and link (or "—" if no PR)
3. Related issues and PRs with links
4. Current status (OPEN, DRAFT, MERGED, CLOSED, local-only)

## Required update triggers

- Creating a new branch for a fix or feature
- Opening a PR
- Discovering a related issue or PR during research
- Changing PR status (draft → ready, open → merged, etc.)
- Closing a PR or issue

## Table format

```markdown
| Branch | PR / Issue | Status |
|---|---|---|
| `claude/short-description` | [PR #N](url) | OPEN (draft) |
```

Add a "Related" paragraph below the table when multiple branches/PRs address the same concern, cross-referencing by PR number and explaining the relationship.
