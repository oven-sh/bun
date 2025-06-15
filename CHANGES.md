# Changes Summary: Rename `bun pm view` to `bun info`

## Overview

This change renames the `bun pm view` command to `bun info` while keeping `bun pm view` as an alias for backward compatibility.

## Files Modified

### 1. `src/cli.zig`

- Added `InfoCommand` to the `Command.Tag` enum
- Changed `"info"` from `.ReservedCommand` to `.InfoCommand` in the `which()` function
- Added handling for `.InfoCommand` in the `start()` function that calls the same logic as `bun pm view`
- Added `"info"` to the `default_completions_list`
- Added help text for the `info` command in `printHelp()`
- Updated the `HelpCommand` help text to include `bun info`
- Added the necessary imports (`PackageManager` and `PmViewCommand`)

### 2. `src/cli/package_manager_command.zig`

- Updated the help text for `bun pm view` to indicate it's an alias for `bun info`

### 3. `test/cli/install/bun-info.test.ts` (renamed from `bun-pm-view.test.ts`)

- Renamed the test file to reflect the primary command name
- Added tests for both `bun info` (main command) and `bun pm view` (alias)
- Organized tests into two describe blocks to test both commands

### 4. `docs/cli/info.md` (new file)

- Created documentation for the new `bun info` command
- Included usage examples and explanations
- Noted that `bun pm view` is an alias

## Implementation Details

The implementation ensures that:

- `bun info` is the primary command for viewing package metadata
- `bun pm view` continues to work as an alias, maintaining backward compatibility
- Both commands share the exact same implementation (calling `PmViewCommand.view()`)
- The help text properly reflects the relationship between the commands

## Testing

The test suite has been updated to verify that:

- Both `bun info` and `bun pm view` work correctly
- All existing functionality is preserved
- The commands produce identical output

## Breaking Changes

None. This change is fully backward compatible as `bun pm view` continues to work as before.
