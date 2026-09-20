Sources are from [llhttp](https://github.com/nodejs/llhttp) 9.4.2, byte for byte as Node.js vendors them in `deps/llhttp` (nodejs/node 110840f2c74). `scripts/run-clang-format.sh` skips this directory: clang-format turns `M-SEARCH` into `M - SEARCH`.

Keep this in sync with:

- `src/jsc/bindings/ProcessBindingHTTPParser.cpp`
- `packages/bun-types/overrides.d.ts`

```
npm ci && make
```

then copy:

- ./build/llhttp.h
- ./build/c/llhttp.c
- ./src/native/api.h
- ./src/native/api.c
- ./src/native/http.c
