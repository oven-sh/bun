# `install` benchmark

Requires [`hyperfine`](https://github.com/sharkdp/hyperfine)

```
$ hyperfine --prepare 'rm -rf node_modules' --warmup 1 --runs 3 'bun install' 'pnpm install' 'yarn' 'npm install'
```
