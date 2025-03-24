ZACK IMPORTANT INFORMATION for implementing `cachedDataRejected`:

- cachedDataRejected is set in two scenarios: A) invalid binary data or B) source code mismatch
- this means that we need to parse the code in the constrcutre of `vm.Script` (this will also solve the sourceMappingURL test not passing)
- this means that we probably need to copy the code from `JSC::evaluate(...)` (inside `Intepreter.cpp`)
- the way that function works is that it does `ProgramExecutable* program = ProgramExecutable::create(globalObject, source)`
- then it does some shit to compile it to bytecode and runs it
- the parsing of the source code and checking the CodeCache happens in `ProgramExecutable::initializeGlobalProperties(...)`
  - this calls `CodeCache::getUnlinkedProgramCodeBlock`
  - which is a wrapper around `CodeCache::getUnlinkedGlobalCodeBlock`
  - which finally calls `CodeCache::findAndUpdateArgs` which will call `fetchFromDiskImpl` downstream
  - `fetchFromDisk` is called when IT IS NOT FOUND IN THE CACHE, it will try to get it from the SourceProvider
  - we should probably always set `cachedDataRejected` to true
  - if it calls upon `fetchFromDisk` and it is successful we can set `cachedDataRejected` to false
  - not sure if it will then later add it to the cache map

# Background

I am working on the node:vm module in the Bun JavaScript runtime which uses JavaScriptCore (JSC) as its JavaScript engine.

I am implementing the `cachedData` option for `new vm.Script()`.

I want to add support to the `cachedDataRejected` property to the `vm.Script` class.

This property is set to false if the cached data is rejected by JSC because it does not match the input source code.

# Your to-do list

- [ ] Add an overriddable method to `JSC::SourceProvider` called `isBytecodeCacheValid` and `setBytecodeCacheValid`
- [ ] Update `fetchFromDiskImpl` in `vendor/WebKit/Source/JavaScriptCore/runtime/CodeCache.cpp`
- [ ] We need to add code which checks that

## Add an overriddable method to `JSC::SourceProvider` called `isBytecodeCacheValid` and `setBytecodeCacheValid`

The `setBytecodeCacheValid` method will be called by JSC if the bytecode cache associated with the source provider is valid.

The `isBytecodeCacheValid` method will be called by JSC to check if the bytecode cache associated with the source provider is valid.

You will add this in `vendor/WebKit/Source/JavaScriptCore/parser/SourceProvider.h`.

Make sure to wrap these changes in the `#if USE(BUN_JSC_ADDITIONS)` macro wrapper.

## Update `fetchFromDiskImpl` in `vendor/WebKit/Source/JavaScriptCore/runtime/CodeCache.cpp`

This is the definition of this function:

```cpp
UnlinkedCodeBlockType* fetchFromDiskImpl(VM& vm, const SourceCodeKey& key)
{
    RefPtr<CachedBytecode> cachedBytecode = key.source().provider().cachedBytecode();
    if (!cachedBytecode || !cachedBytecode->size())
        return nullptr;
    return decodeCodeBlock<UnlinkedCodeBlockType>(vm, key, *cachedBytecode);
}
```

Basically the `return decodeCodeBlock<UnlinkedCodeBlockType>(vm, key, *cachedBytecode);` line will return a `nullptr` if it could not decode the bytecod

NOTE: this is just ONE way that the cached data can be rejected; when it is invalid

## Add a check in `constructScript` in `NodeVM.cpp` to check the bytecode cache source matches the input source code

ANOTHER way that the cached data can be rejected is if the source code of the bytecode cache does not match the input source code.

## Appendix: Node.js documentation for `new vm.Script()`

Documentation from Node.js:

```
# new vm.Script(code[, options])

- `code` <string> The JavaScript code to compile.
- `options` <Object> | <string>
  - `filename` <string> Specifies the filename used in stack traces produced by this script. Default: 'evalmachine.<anonymous>'.
  - `lineOffset` <number> Specifies the line number offset that is displayed in stack traces produced by this script. Default: 0.
  - `columnOffset` <number> Specifies the first-line column number offset that is displayed in stack traces produced by this script. Default: 0.
  - `cachedData` <Buffer> | <TypedArray> | <DataView> Provides an optional Buffer or TypedArray, or DataView with V8's code cache data for the supplied source. When supplied, the `cachedDataRejected` value will be set to either true or false depending on acceptance of the data by V8.
  - `produceCachedData` <boolean> When true and no cachedData is present, V8 will attempt to produce code cache data for code. Upon success, a Buffer with V8's code cache data will be produced and stored in the `cachedData` property of the returned vm.Script instance. The `cachedDataProduced` value will be set to either true or false depending on whether code cache data is produced successfully. This option is deprecated in favor of `script.createCachedData()`. Default: false.
  - `importModuleDynamically` <Function> | <vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER> Used to specify how the modules should be loaded during the evaluation of this script when `import()` is called. This option is part of the experimental modules API. We do not recommend using it in a production environment. For detailed information, see Support of dynamic import() in compilation APIs.

If `options` is a string, then it specifies the filename.

Creating a new `vm.Script` object compiles code but does not run it. The compiled `vm.Script` can be run later multiple times. The code is not bound to any global object; rather, it is bound before each run, just for that run.

```
