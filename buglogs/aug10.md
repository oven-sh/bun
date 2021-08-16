```
ModuleNotFound on resolving "object-assign" from "/Users/jarred/Code/bun/demos/css-stress-test/node_modules/react-dom/cjs/"
```

Happens with `--platform=browser` when importing react while building the .jsb

`object-assign` doesn't have a `main` field set. That's not a bug; this should work.

The error doesn't happen when `main` is set in `object-assign`'s `package.json`.

It turns out, this was a data race! It was fixed by disabling building .jsb in parallel
