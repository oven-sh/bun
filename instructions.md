# Fixing CSS modules in Bun's dev server

Look inside the reproduction folder: /Users/zackradisic/Code/bun-repro-18258/

When importing a CSS module, it is not being resolved correctly and the following error is thrown:

```
frontend ReferenceError: import_Ooga_module is not defined
      at App (/Users/zackradisic/Code/bun-repro-18258/src/App.tsx:5:21)
      at react-stack-bottom-frame (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:23863:20)
      at renderWithHooks (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:5529:22)
      at updateFunctionComponent (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:8897:19)
      at beginWork (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:10522:18)
      at runWithFiberInDEV (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:1519:30)
      at performUnitOfWork (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:15132:22)
      at workLoopSync (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:14956:41)
      at renderRootSync (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:14936:11)
      at performWorkOnRoot (/Users/zackradisic/Code/bun-repro-18258/node_modules/react-dom/cjs/react-dom-client.development.js:14462:44)
```

Some notes on how CSS modules work:

- We generate a JS object where the keys are the class names and the values are the class names made unique. This starts on line 226 in `generateCodeForLazyExport.zig`. We do this using `E.NameOfSymbol` which uses a `Ref` because we don't know the final generated name until after all CSS modules are parsed.
- The `mangleLocalCss` (inside `LinkerContext.zig`) is called after all CSS modules are parsed. It is used to mangle the class names in the CSS modules so that they are unique.

Some notes about how Bun's dev server is different and is what likely causing the issue:

- The dev server skips stuff and doesn't call all the same linker functions
- This is causing `generateCodeForLazyExport` to _not_ be called and thus the JS object is not generated for importing CSS modules
- We will have to create our own routine which will do this
- One key place to look at is `finalizeBundle(...)` in `DevServer.zig`, that's when the bundle is finalized.

You instructions:

1. Split out the existing code in `generateCodeForLazyExport` which handles CSS into a new function which can be called separately
2. Call this new function in `finalizeBundle(...)` in `DevServer.zig`

**IMPORTANT**: If you need ANY help from me (for example running bun or something), please ask me by executing the command `say bun2 help`.
