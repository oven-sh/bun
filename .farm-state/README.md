Handoff state for the still-broken-issue grind.

- handoff-specs.json: 815 {issue,title,brief} entries verified still-broken on main df84f8db1
- handoff-done.txt: newline-separated issue numbers already handed off

Timer sessions fetch this branch, read both files, hand off the next 6 via RobobunBugFixHandOff, append to handoff-done.txt, commit, push.
