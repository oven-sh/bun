### What does this PR do?

<!-- **Please explain what your changes do**, example: -->

<!--

This adds a new flag --bail to bun test. When set, it will stop running tests after the first failure. This is useful for CI environments where you want to fail fast.

-->

- [ ] Documentation or TypeScript types (it's okay to leave the rest blank in this case)
- [ ] Code changes

### How did you verify your code works?

<!-- **For code changes, please include automated tests**. Feel free to uncomment the line below -->

<!-- I wrote automated tests -->

<!-- If JavaScript/TypeScript modules or builtins changed:

- [ ] I included a test for the new code, or existing tests cover it
- [ ] I ran my tests locally and they pass (`bun-debug test test-file-name.test`)

-->

<!-- If Zig files changed:

- [ ] I checked the lifetime of memory allocated to verify it's (1) freed and (2) only freed when it should be
- [ ] I included a test for the new code, or an existing test covers it
- [ ] JSValue used outside outside of the stack is either wrapped in a JSC.Strong or is JSValueProtect'ed
- [ ] I wrote TypeScript/JavaScript tests and they pass locally (`bun-debug test test-file-name.test`)
-->

<!-- If new methods, getters, or setters were added to a publicly exposed class:

- [ ] I added TypeScript types for the new methods, getters, or setters
-->

<!-- If dependencies in tests changed:

- [ ] I made sure that specific versions of dependencies are used instead of ranged or tagged versions
-->

<!-- If a new builtin ESM/CJS module was added:

- [ ] I updated Aliases in `module_loader.zig` to include the new module
- [ ] I added a test that imports the module
- [ ] I added a test that require() the module
-->
