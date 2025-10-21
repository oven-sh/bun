---
allowed-tools: Bash(gh issue view:*), Bash(gh search:*), Bash(gh issue list:*), Bash(gh api:*), Bash(gh issue comment:*)
description: Find duplicate GitHub issues
---

# Issue deduplication command

Find up to 3 likely duplicate issues for a given GitHub issue.

To do this, follow these steps precisely:

1. Use an agent to check if the GitHub issue (a) is closed, (b) does not need to be deduped (eg. because it is broad product feedback without a specific solution, or positive feedback), or (c) already has a duplicate detection comment (check for the exact HTML marker `<!-- dedupe-bot:marker -->` in the issue comments - ignore other bot comments). If so, do not proceed.
2. Use an agent to view a GitHub issue, and ask the agent to return a summary of the issue
3. Then, launch 5 parallel agents to search GitHub for duplicates of this issue, using diverse keywords and search approaches, using the summary from Step 2. **IMPORTANT**: Always scope searches with `repo:owner/repo` to constrain results to the current repository only.
4. Next, feed the results from Steps 2 and 3 into another agent, so that it can filter out false positives, that are likely not actually duplicates of the original issue. If there are no duplicates remaining, do not proceed.
5. Finally, comment back on the issue with a list of up to three duplicate issues (or zero, if there are no likely duplicates)

Notes (be sure to tell this to your agents, too):

- Use `gh` to interact with GitHub, rather than web fetch
- Do not use other tools, beyond `gh` (eg. don't use other MCP servers, file edit, etc.)
- Make a todo list first
- Always scope searches with `repo:owner/repo` to prevent cross-repo false positives
- For your comment, follow the following format precisely (assuming for this example that you found 3 suspected duplicates):

---

Found 3 possible duplicate issues:

1. <link to issue>
2. <link to issue>
3. <link to issue>

This issue will be automatically closed as a duplicate in 3 days.

- If your issue is a duplicate, please close it and 👍 the existing issue instead
- To prevent auto-closure, add a comment or 👎 this comment

🤖 Generated with [Claude Code](https://claude.ai/code)

<!-- dedupe-bot:marker -->

---
