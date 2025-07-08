# Not stripping out `dbHelper(...)` functions from Zig

The Zig standard library data structures have fn dbHelper(...) functions which
are used by the lldb_pretty_printers.py script to provide nice formatting for
std.MultiArrayList(...) etc.

Currently, we just strip out all debug/dwarf symbols by using the `-dead_strip` option (see BuildBun.cmake).

However, there are the following problems with that:

```
This will make the debug build larger which makes it take longer to load in the debugger and also on disk.

Instead, we should mark the specific symbols as used in debug builds.
```

First read the releveant dead strip liens in BuildBun.cmake.

Second, tell me if it is possible to strip out symbols selectively, if there is a linker flag that allows this?

If the answer to the second questoin is NO, don't do anything.

If the answer to the second question is YES, then:

1. Comment out the `-dead_strip` option in BuildBun.cmake and build bun
2. Use llvm-dwarfdump (or llvm-nm, I can't remember which one) and search for `*dbHelper*` symbols
3. Turn that into a script which generates the list of symbols to keep in the debug build
4. You'll have to make the build system add these symbols in the linker flags. Can CMake files allow you to do command substitution?

When you are done, or you need help (or are blocked), execute the command:
`say agent 1`
