## Using bun as a package manager

On Linux, `bun install` tends to install packages 20x - 100x faster than `npm install`. On macOS, it’s more like 4x - 80x.

<img src="https://user-images.githubusercontent.com/709451/147004342-571b6123-17a9-49a2-8bfd-dcfc5204047e.png" height="200" />

To install packages from package.json:

```bash
bun install
```

To add or remove packages from package.json:

```bash
bun remove react
bun add preact
```

<strong>For Linux users</strong>: <code>bun install</code> needs Linux Kernel 5.6 or higher to work well

The minimum Linux Kernel version is 5.1. If you're on Linux kernel 5.1 - 5.5, `bun install` should still work, but HTTP requests will be slow due to a lack of support for io_uring's `connect()` operation.

If you're using Ubuntu 20.04, here's how to install a [newer kernel](https://wiki.ubuntu.com/Kernel/LTSEnablementStack):

```bash
# If this returns a version >= 5.6, you don't need to do anything
uname -r

# Install the official Ubuntu hardware enablement kernel
sudo apt install --install-recommends linux-generic-hwe-20.04
```
