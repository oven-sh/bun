Status

- Reproduced on main 5866b5f13d (Linux x64, debug and release builds) with the 12-line script in the description. It prints `callbacks fired in the order 2,1,3` and exits 1. With this branch, and on Node v26.3.0, it prints `1,2,3` and exits 0.
- The same script shape on `process.stdout` is in `test/js/node/process/process-stdio-write-callback.test.ts`. 64 of the 114 tests in the three touched files fail on main.
- This PR is a draft until #42031 is in. The description says why under Downsides.

PR: https://github.com/oven-sh/bun/pull/45552
