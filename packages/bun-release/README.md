# bun-release

Scripts that release Bun to npm, Dockerhub, Homebrew, etc.

### Running

```sh
bun run npm # build assets for the latest release
bun run npm -- <release> # build assets for the provided release
bun run npm -- <release> [dry-run|publish] # build and publish assets to npm
```

### Credits

- [esbuild](https://github.com/evanw/esbuild), for its npm scripts which this was largely based off of.
