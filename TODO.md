need to support bun.timespec.now() for time mocking

- support performance.now
- consider supporting edge-case where `timeout0(A, timeout0(B)), timeout0(C)` prints `A=0, C=0, B=1` (date.now())
