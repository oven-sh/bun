# `install` benchmark

Requires [`hyperfine`](https://github.com/sharkdp/hyperfine)

```
$ hyperfine --prepare 'rm -rf node_modules' --warmup 1 --runs 3 'bun install' 'pnpm install' 'yarn' 'npm install'
```

To check that the app is working as expected:

```
$ bun run dev
$ npm run dev
$ yarn dev
$ pnpm dev
```

Then visit [http://localhost:3000](http://localhost:3000).
