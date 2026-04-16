---
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh search:*), Bash(gh pr list:*), Bash(gh api:*), Bash(gh pr comment:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git ls-files:*), Bash(git grep:*), Bash(git branch:*), Bash(git remote:*)
description: Find open PRs that may duplicate a given PR
---

# Find duplicate PRs command

Find other open, unmerged pull requests that may be duplicates of (or substantially overlap with) a given PR.

To do this, follow these steps precisely:

1. Use an agent to check if the PR (a) is closed/merged, or (b) already has a duplicate-PR comment (check for the exact HTML marker `<!-- find-duplicate-prs-bot:marker -->` in the PR comments — ignore other bot comments). If so, do not proceed.
2. Use an agent to view the PR title, body, and diff (`gh pr view` and `gh pr diff`), and ask the agent to return a summary of:
   - What the PR changes (files modified, functions changed, features added/fixed)
   - Key technical terms, error messages, API names, or module names involved
   - Any issue numbers referenced (e.g. "fixes #123") — two PRs that fix the same issue are likely duplicates
3. Then, launch 3 parallel agents to search GitHub for other **open, unmerged** pull requests that may duplicate this one, using diverse keywords derived from the summary in Step 2. **IMPORTANT**: Always scope searches with `repo:owner/repo is:pr is:open is:unmerged` to constrain results to the current repository. Each agent should try a different search strategy:
   - Agent 1: Search using the PR title keywords and referenced issue numbers
   - Agent 2: Search using `gh pr list` filtered by the same files/paths touched in the diff
   - Agent 3: Search using feature/API/function names from the changed code
4. Next, feed the results from Steps 2 and 3 into another agent, so that it can filter out false positives that are not actually duplicates. Exclude the PR itself. Only keep PRs that change the same code area for the same purpose, or fix the same referenced issue. **If there are no likely duplicates remaining, do not comment at all** — silently exit.
5. Finally, if and only if at least one likely duplicate was found, comment on the PR.

Notes (be sure to tell this to your agents, too):

- Use `gh` to interact with GitHub, rather than web fetch
- You may also use read-only `git` commands (`git diff`, `git log`, `git show`, `git grep`, etc.) against the local checkout
- Do not use other tools beyond `gh` and `git` (eg. don't use other MCP servers, file edit, etc.)
- Make a todo list first
- Always scope searches with `repo:owner/repo` to prevent cross-repo false positives
- Only match against **open, unmerged** PRs — do not suggest closed, merged, or draft PRs
- Never include the input PR in the results
- **Do not post a comment if zero duplicates are found**
- For your comment, follow the following format precisely (assuming for this example that you found 2 likely duplicates):

---

This PR may be a duplicate of:

1. <link to PR> - <one-line summary of why it overlaps>
2. <link to PR> - <one-line summary of why it overlaps>

🤖 Generated with [Claude Code](https://claude.ai/code)

<!-- find-duplicate-prs-bot:marker -->

---
