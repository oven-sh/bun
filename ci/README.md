# CI

This directory contains scripts for building CI images for Bun.

## Building

### `macOS`

On macOS, images are built using [`tart`](https://tart.run/), a tool that abstracts over the [`Virtualization.Framework`](https://developer.apple.com/documentation/virtualization) APIs, to run macOS VMs.

To install the dependencies required, run:

```sh
$ cd ci
$ bun run bootstrap
```

To build a vanilla macOS VM, run:

```sh
$ bun run build:darwin-aarch64-vanilla
```

This builds a vanilla macOS VM with the current macOS release on your machine. It runs scripts to disable things like spotlight and siri, but it does not install any software.

> Note: The image size is 50GB, so make sure you have enough disk space.

If you want to build a specific macOS release, you can run:

```sh
$ bun run build:darwin-aarch64-vanilla-15
```

> Note: You cannot build a newer release of macOS on an older macOS machine.

To build a macOS VM with software installed to build and test Bun, run:

```sh
$ bun run build:darwin-aarch64
```

## Running

### `macOS`

## How To

### Support a new macOS release

1. Visit [`ipsw.me`](https://ipsw.me/VirtualMac2,1) and find the IPSW of the macOS release you want to build.

2. Add an entry to [`ci/darwin/variables.pkr.hcl`](/ci/darwin/variables.pkr.hcl) with the following format:

```hcl
sonoma = {
  distro  = "sonoma"
  release = "15"
  ipsw    = "https://updates.cdn-apple.com/..."
}
```

3. Add matching scripts to [`ci/package.json`](/ci/package.json) to build the image, then test it:

```sh
$ bun run build:darwin-aarch64-vanilla-15
```

> Note: If you need to troubleshoot the build, you can remove the `headless = true` property from [`ci/darwin/image-vanilla.pkr.hcl`](/ci/darwin/image-vanilla.pkr.hcl) and the VM's screen will be displayed.

4. Test and build the non-vanilla image:

```sh
$ bun run build:darwin-aarch64-15
```

This will use the vanilla image and run the [`scripts/bootstrap.sh`](/scripts/bootstrap.sh) script to install the required software to build and test Bun.

5. Publish the images:

```sh
$ bun run login
$ bun run publish:darwin-aarch64-vanilla-15
$ bun run publish:darwin-aarch64-15
```
