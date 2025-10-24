- [ ] something is wrong in the diff for napi.zig. how come it adds a `pub fn enqueue(this: *Finalizer)` and a `pub fn deinit(this: *Finalizer)`. did I mess up a merge
- [ ] how come it adds code in b/test/js/bun/css/css.test.ts
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
