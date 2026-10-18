Two of the three are done in d8c5baf2c4.

- Under Bun the child now runs with `bunExe()` and `bunEnv` from the harness. Under Node.js it runs with `process.execPath`.
- The check for the absence of `error:` is gone. The assertion shows stderr only when the child fails.
- The timeout stays. The test starts a second process of the build under test, which takes 2.1 to 2.6 s on a debug build here, against the 5 s default of a local run. Root `CLAUDE.md` allows a per-test timeout for that kind of outlier. In CI the runner passes 90 s per test, so the option changes nothing there. The comment above the test now says that.
