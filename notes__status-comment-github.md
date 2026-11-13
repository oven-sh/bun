**Status**

How I reproduced it, on a build of main (89452d2ac1):

```sh
mkdir -p r/src && cd r
echo '{"compilerOptions":{"strict":true,"lib":["es2015"],"useDefineForClassFields":false,"module":"preserve","moduleResolution":"bundler","noEmit":true,"types":[]}}' > tsconfig.json
echo '{"name":"f","version":"1.0.0","compilerOptions":{"strict":true,"lib":["es2015"],"useDefineForClassFields":false}}' > package.json
cat > src/index.ts <<'TS'
export class Box {
  n = 1;
  label(): string {
    return String(this.n);
  }
}
TS
bun build ./src/index.ts --dts --outdir out
# warn: the .aot.ts files that --aot compiles a package from are left out: they have type errors, the first at index.aot.ts:4:10: TS2339: Property 'n' does not exist on type 'Box'.
ls out   # index.d.ts index.js
```

With this PR the same build prints no warning, and `out/index.aot.ts` has `declare n: number;`.

PR: https://github.com/oven-sh/bun/pull/48716



