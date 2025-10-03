To upgrade Bun, run `bun upgrade`.

It automatically downloads the latest version of Bun and overwrites the currently-running version.

This works by checking the latest version of Bun in [bun-releases-for-updater](https://github.com/Jarred-Sumner/bun-releases-for-updater/releases) and unzipping it using the system-provided `unzip` library (so that Gatekeeper works on macOS)

If for any reason you run into issues, you can also use the curl install script:

```bash
$ curl https://bun.com/install | bash
```

It will still work when Bun is already installed.

Bun is distributed as a single binary file, so you can also do this manually:

- Download the latest version of Bun for your platform in [bun-releases-for-updater](https://github.com/Jarred-Sumner/bun-releases-for-updater/releases/latest) (`darwin` == macOS)
- Unzip the folder
- Move the `bun` binary to `~/.bun/bin` (or anywhere)

## `--canary`

[Canary](https://github.com/oven-sh/bun/releases/tag/canary) builds are generated on every commit.

To install a [canary](https://github.com/oven-sh/bun/releases/tag/canary) build of Bun, run:

```bash
$ bun upgrade --canary
```

This flag is not persistent (though that might change in the future). If you want to always run the canary build of Bun, set the `BUN_CANARY` environment variable to `1` in your shell's startup script.

This will download the release zip from https://github.com/oven-sh/bun/releases/tag/canary.

To revert to the latest published version of Bun, run:

```bash
$ bun upgrade
```
