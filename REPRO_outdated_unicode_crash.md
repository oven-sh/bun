# Reproduction for `bun outdated` Unicode Crash

## Issue
`bun outdated` panics with "index out of bounds: index 19909, len 17037" when displaying catalog dependencies with workspace names containing multi-byte UTF-8 characters.

## Root Cause
The table formatting code in `src/cli/outdated_command.zig` and `src/fmt.zig` uses **byte length** (`.len`) to calculate column widths and padding, but should use **display width** (grapheme cluster count or similar) for strings containing Unicode characters.

### Affected Code Locations

1. **src/cli/outdated_command.zig:508** - Calculates max workspace column width using byte length:
   ```zig
   if (names.len > new_max_workspace) new_max_workspace = names.len;
   ```

2. **src/cli/outdated_command.zig:676** - Prints padding using byte length:
   ```zig
   for (workspace_name.len..workspace_column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
   ```

3. **src/fmt.zig:98** - Table header printing uses byte length:
   ```zig
   for (this.column_names[i].len..column_inside_length + column_right_pad) |_| Output.pretty(" ", .{});
   ```

4. Similar issues in other table printing locations (lines 612, 622, 642, 662 in outdated_command.zig)

### Why It Crashes on Windows
The catalog workspace names string can be very long in bytes when it contains emoji and multi-byte UTF-8 characters. For example:
- 100 workspaces with emoji names: ~7600 bytes but only ~4600 characters display width
- The code sets column width to 7600 (byte length)
- When printing a row, it tries to write `7600 - workspace_name.len` padding spaces
- This can exceed the Windows output buffer size (17037 bytes shown in crash), causing "index out of bounds"

## Reproduction Steps

### Setup Test Project
```bash
mkdir -p /tmp/outdated-unicode-repro
cd /tmp/outdated-unicode-repro

# Create root package.json with catalog
cat > package.json <<'EOF'
{
  "name": "outdated-unicode-repro",
  "version": "1.0.0",
  "workspaces": ["packages/*"],
  "catalog": {
    "react": "18.0.0"
  }
}
EOF

# Create 100+ workspace packages with Unicode names
for i in {1..150}; do
  mkdir -p packages/pkg$i
  cat > packages/pkg$i/package.json <<EOF
{
  "name": "@workspace/🎉🎊🎈🎁🎀🎂🎃🎄🎅🎆🎇🎐🎑🎒🎓-$i",
  "version": "1.0.0",
  "dependencies": {
    "react": "catalog:"
  }
}
EOF
done

bun install
```

### Trigger the Crash
```bash
bun outdated -r
```

**Expected**: Should crash on Windows with "index out of bounds" panic.
**Note**: May not crash on Linux due to larger output buffers, but the bug still exists.

## Impact
- Affects Windows users more severely due to smaller output buffer
- Any workspace with Unicode package names can trigger this
- The more workspaces using a catalog dependency with Unicode names, the more likely to crash

## Test with Debug Build
```bash
/workspace/bun/build/debug/bun-debug outdated -r
```

The debug build may have better bounds checking that could help identify the exact overflow.
