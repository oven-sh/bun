# State of the work on oven-sh/bun#44337 (written 2026-10-18 05:25 UTC)

- PR #44337: base `main`, ready for review (not a draft). Head d8c5baf2c4.
  Commits: #44248's three (rebased), the pins (1df6a37548), the limit (f3cca1e32e), the empty retrigger (d0736b318c),
  and d8c5baf2c4 (review response: `refused_ids` keeps at most 2048 ids; the test spawns Bun through the harness).
- claude[bot] reviewed at d0736b318c: nothing blocking, 6 threads, all answered and resolved at d8c5baf2c4.
- The one `ci: retrigger` of this conversation is SPENT (d0736b318c). Do not push another.
- #44335 is closed (folded in). Do not reopen.
- #37985 (alii) is NOT carried. No new comment was posted there. Reason is in the PR body ("The refused ids").
- Shape: engine refusal + O(1) count + `refused_ids` for HEADERS and DATA on refused ids. No same-read slot hold.
- CI build 127986 at f3cca1e32e: all Linux and Windows lanes passed. darwin aarch64: one shard failed on
  "buildkite-agent artifact download timed out" (infra). darwin x64 was still scheduled.
- Earlier real CI failure (build 127965): the node self-spawn failed on Windows, because `outcome()` read
  `served.sessionError` before the server session emitted it. Fixed: `outcome()` awaits `served.sessionClosed`.
- Next:
  1. When CI is green on the head: request a review from cirospaciari
     (`gh api -X POST repos/oven-sh/bun/pulls/44337/requested_reviewers -f 'reviewers[]=cirospaciari'`;
     `gh pr edit` fails on token scopes).
  2. If CI is red only on lanes the diff does not touch: say so in the status comment and give_up
     ("CI flaky on unrelated lanes, diff is green, needs a maintainer to merge").
- GitHub ids: PR node id PR_kwDOFVKCyc8AAAABF_tkrQ. Status comment 5922058212 (node IC_kwDOFVKCyc8AAAABYPtv5A).
  Node report comment 5949423804 (node IC_kwDOFVKCyc8AAAABYp0AvA).
- REST and GraphQL quotas of the robobun account run out often. `gh pr edit` does not work (scopes): use
  `gh api graphql` mutations (updatePullRequest, updateIssueComment, addComment) or REST.
- Body source: final/body.md, made by final/fill-body.py from final/body.tmpl3.md, cost-final.txt, measure-final.txt.
  Before a rewrite, fetch the live body first: the gate writes its proof block into it.
- Lesson: set the base of a PR BEFORE a push that moves the head to a newer main. Otherwise the bot reviews the
  whole of main (11 stray comment-cop threads were answered and resolved).
