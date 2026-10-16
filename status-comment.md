Status

- On hold, do not merge. A third self-review found three regressions in this draft. They are listed under Downsides in the description, with the commands that show them. #45319 now fixes the reported order in the sink, and the shape of this PR is under review against it.
- Reproduced on main 5866b5f13d (Linux x64, debug and release builds) with the 12-line script in the description. It prints `callbacks fired in the order 2,1,3` and exits 1. With this branch, on a build of main with #45319, and on Node v26.3.0, it prints `1,2,3` and exits 0.
- This PR also needs #42031 first. The description says why under Downsides.

PR: https://github.com/oven-sh/bun/pull/45552
