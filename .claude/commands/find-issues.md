---
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh search:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh api:*), Bash(gh pr comment:*)
description: Find GitHub issues that a PR might fix
---

# Find issues for PR command

Find open GitHub issues that a pull request might fix. Include all likely matches — do not artificially limit the number of results.

To do this, follow these steps precisely:

1. Use an agent to check if the PR (a) is closed/merged, or (b) already has a related-issues comment (check for the exact HTML marker `<!-- find-issues-bot:marker -->` in the PR comments - ignore other bot comments). If so, do not proceed.
2. Use an agent to view the PR title, body, and diff (`gh pr view` and `gh pr diff`), and ask the agent to return a summary of:
   - What the PR changes (files modified, functions changed, features added/fixed)
   - Key technical terms, error messages, API names, or module names involved
   - Any issue numbers already referenced in the PR body or commit messages
3. Then, launch 5 parallel agents to search GitHub for open issues that this PR might fix, using diverse keywords and search approaches derived from the summary in Step 2. **IMPORTANT**: Always scope searches with `repo:owner/repo` to constrain results to the current repository only. Each agent should try a different search strategy:
   - Agent 1: Search using error messages or symptoms described in the diff
   - Agent 2: Search using feature/module names from the changed files
   - Agent 3: Search using API names or function names that were modified
   - Agent 4: Search using keywords from the PR title and description
   - Agent 5: Search using broader terms related to the area of code changed
4. Next, feed the results from Steps 2 and 3 into another agent, so that it can filter out false positives that are likely not actually related to the PR's changes. Exclude issues already referenced in the PR body (e.g. "fixes #123", "closes #456", "resolves #789"). Only keep issues where the PR changes are clearly relevant to the issue. If there are no related issues remaining, do not proceed.
5. Finally, comment on the PR with all related open issues found (or zero, if there are no likely matches). Do not cap the number — list every issue that is a likely match.

Notes (be sure to tell this to your agents, too):

- Use `gh` to interact with GitHub, rather than web fetch
- Do not use other tools, beyond `gh` (eg. don't use other MCP servers, file edit, etc.)
- Make a todo list first
- Always scope searches with `repo:owner/repo` to prevent cross-repo false positives
- Only match against **open** issues - do not suggest closed issues
- Exclude issues that are already linked in the PR description
- For your comment, follow the following format precisely (assuming for this example that you found 3 related issues):

---

Found 3 issues this PR may fix:

1. <link to issue> - <one-line summary of why this PR is relevant>
2. <link to issue> - <one-line summary of why this PR is relevant>
3. <link to issue> - <one-line summary of why this PR is relevant>

> If this is helpful, consider adding `Fixes #<number>` to the PR description to auto-close the issue on merge.

🤖 Generated with [Claude Code](https://claude.ai/code)

<!-- find-issues-bot:marker -->

---
