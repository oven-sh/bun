# `install` benchmark

Requires [`hyperfine`](https://github.com/sharkdp/hyperfine). The goal of this benchmark is to compare installation performance of Bun with other package managers _when caches are hot_.

### With lockfile, online mode

To run the benchmark with the standard "install" command for each package manager:

```sh
$ hyperfine --prepare 'rm -rf node_modules' --warmup 1 --runs 3 'bun install' 'pnpm install' 'yarn' 'npm install'
```

### With lockfile, offline mode

Even though all packages are cached, some tools may hit the npm API during the version resolution step. (This is not the same as re-downloading a package.) To entirely avoid network calls, the other package managers require `--prefer-offline/--offline` flag. To run the benchmark using "offline" mode:

```sh
$ hyperfine --prepare 'rm -rf node_modules' --runs 1 'bun install' 'pnpm install --prefer-offline' 'yarn --offline' 'npm install --prefer-offline'
```

### Without lockfile, offline mode

To run the benchmark with offline mode but without lockfiles:

```sh
$ hyperfine --prepare 'rm -rf node_modules' --warmup 1 'rm bun.lock && bun install' 'rm pnpm-lock.yaml && pnpm install --prefer-offline' 'rm yarn.lock && yarn --offline' 'rm package-lock.json && npm install --prefer-offline'
```

##

To check that the app is working as expected:

```
$ bun run dev
$ npm run dev
$ yarn dev
$ pnpm dev
```

Then visit [http://localhost:3000](http://localhost:3000).
