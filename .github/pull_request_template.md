## What does this PR do?

<!-- **Please use words to describe your changes**, example: -->

<!--

This adds a new flag --bail to bun test. When set, it will stop running tests after the first failure. This is useful for CI environments where you want to fail fast.

-->

- [ ] Documentation or TypeScript types (it's okay to leave the rest blank in this case)
- [ ] Code changes

### How did you verify your code works?

<!-- **For code changes, please include automated tests**. Feel free to uncomment the line below -->

<!-- I wrote automated tests -->

### Checklist

<!-- **Please delete the sections which are not relevant. If there were no code changes, feel free to delete or ignore this section entirely** -->

If JavaScript/TypeScript modules or builtins changed:

- [ ] I ran `make js` and committed the transpiled changes
- [ ] I or my editor ran Prettier on the changed files (or I ran `bun fmt`)
- [ ] I included a test for the new code, or an existing test covers it

If Zig files changed:

- [ ] I checked the lifetime of memory allocated to verify it's (1) freed and (2) only freed when it should be
- [ ] I or my editor ran `zig fmt` on the changed files
- [ ] I included a test for the new code, or an existing test covers it
- [ ] JSValue used outside outside of the stack is either wrapped in a JSC.Strong or is JSValueProtect'ed

If new methods, getters, or setters were added to a publicly exposed class:

- [ ] I added TypeScript types for the new methods, getters, or setters

If dependencies in tests changed:

- [ ] I made sure that specific versions of dependencies are used instead of ranged or tagged versions

If functions were added to exports.zig or bindings.zig

- [ ] I ran `make headers` to regenerate the C header file

If \*.classes.ts files were added or changed:

- [ ] I ran `make codegen` to regenerate the C++ and Zig code

If a new builtin ESM/CJS module was added:

- [ ] I updated Aliases in `module_loader.zig` to include the new module
- [ ] I added a test that imports the module
- [ ] I added a test that require() the module
