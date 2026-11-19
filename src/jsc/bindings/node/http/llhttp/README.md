Sources are from [llhttp](https://github.com/nodejs/llhttp) 9.4.4, byte for byte as Node.js v26.13.1 vendors them in `deps/llhttp`. `scripts/run-clang-format.sh` skips this directory: clang-format turns `M-SEARCH` into `M - SEARCH`.

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
