- [ ] migrate {} to {f} by adding a compileError
- [ ] remove deprecated.BufferedWriter and BufferedReader

Follow-up:

- [ ] remove override_no_export_cpp_apis as it is no longer needed
- [ ] css Parser(W) -> Parser, and remove all the comptime writer: type params
- [ ] remove old writers fully

Notes:

- ConsoleObject.zig fn 'getWidthForValue' likely gets slower - going from generic 'count += n' to now using unnecessary memcpys instead. maybe should be re-genericized?
- uses of 'bun.deprecated.jsErrorToWriteError' are problematic
- output stuff is messy and complicated
