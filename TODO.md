- [ ] migrate {} to {f} by adding a compileError
- [ ] remove deprecated.BufferedWriter and BufferedReader

Follow-up:

- [ ] css Parser(W) -> Parser, and remove all the comptime writer: type params

Notes:

- ConsoleObject.zig fn 'getWidthForValue' likely gets slower - going from generic 'count += n' to now using unnecessary memcpys instead. maybe should be re-genericized?
- output stuff is messy and complicated
