TODO:

- [x] identify and fix ISSUE1.js
- [x] revert commit 'revertrevert' 43009bb1f297789596c4d9b424f1c22647891986 and get building again
- [ ] linux: no_link_obj
- [x] windows
- [ ] remove deprecated.BufferedWriter and BufferedReader
- [x] try the native backend on linux x86_64 (will probably crash)
- [ ] remove:
  - [ ] deprecated.zig autoFormatLabelFallback
  - [ ] deprecated.zig autoFormatLabel
  - [ ] bun.zig maybeAdaptWriter

Follow-up:

- [ ] search `comptime Writer: type` and `comptime W: type` and remove
- [ ] remove format_mode in main.zig and in our zig fork

Follow-up:

- [ ] remove override_no_export_cpp_apis as it is no longer needed
- [ ] css Parser(W) -> Parser, and remove all the comptime writer: type params
- [ ] remove old writers fully

Notes:

- ConsoleObject.zig fn 'getWidthForValue' likely gets slower - going from generic 'count += n' to now using unnecessary memcpys instead. maybe should be re-genericized?
- uses of 'bun.deprecated.jsErrorToWriteError' are problematic
- output stuff is messy and complicated
