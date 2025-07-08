# Shell Crash Reproduction

This repository reproduces a Bun crash on Windows when running `bun run format`.

## Reproduction Steps

1. Navigate to this directory
2. Run `bun install` to install dependencies
3. Run `bun run format` 
4. The crash should occur

## Notes

- Running `npx prettier --write src/**/*.ts` directly works fine
- The crash only occurs when running through the npm script
- This appears to be related to Bun's shell implementation on Windows

## Expected vs Actual

**Expected**: The prettier command should format all TypeScript files in the src directory.

**Actual**: Bun crashes with a segmentation fault at address 0xFFFFFFFFFFFFFFFF.

## Environment

Tested with Bun v1.2.18 on Windows.