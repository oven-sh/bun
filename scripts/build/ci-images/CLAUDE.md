# CI machine images

CI's build and test machines start from images baked ahead of time: AWS AMIs for Linux, Azure Compute Gallery images for Windows. This directory says what is on them and generates what bakes them. macOS test machines are described here too, but CI does not bake them (see [macOS](#macos)).

## How it works

- **`spec.ts` is the one place anything is written.** `images` lists every image with the exact base image it starts from. `pins` holds every version. `locations` holds where a bake puts what is not the operating system's to place (`/opt/rust`, the sysroots, `C:\Scoop`); a tool is handed its location the way it is handed its pin, and whatever looks for one (the build's sysroot lookups, the download cache, the Intel SDE step) imports it. `linuxTools()`, `windowsTools()` and `macosTools()` list what goes on a machine, in order. The build system's own LLVM, Node.js, xwin, Windows SDK, macOS SDK, Android API level and FreeBSD versions import from `pins`; `test/internal/source-lints/ci-image-pins.test.ts` keeps the files that cannot import it (`rust-toolchain.toml`, the GitHub workflows) in step.
- **A tool** is one thing a bake sets up on the machine, whether it installs something (Bun, LLVM) or configures the system (`ulimits`, `agent-user`, `cleanup`). It is a function in `tools/<name>.ts` that takes the image and its pin and returns a `Tool`: the script to run (`tools/linux/*.sh`, `tools/windows/*.ps1`, `tools/macos/*.sh`), the variables that script gets, and any repository files it needs. URLs and per-architecture names are computed in the function, so scripts do not branch on distro or architecture. A tool that exists on several systems is one function with one pin. Every script under `tools/<os>/` is named by exactly one `tools/*.ts`, except two files that a tool puts on the machine to run later instead of running during the bake: `tools/windows/fetch-ssh-keys.ps1` (the `openssh` tool; runs at every Windows boot) and `tools/record-image.mts` (the `record-image` tool; writes `bun-image.json`).
- **`generate.ts`** turns an image into `build/ci-images/<key>/`: `image.json` (the image's facts, its base image, and every tool with its variables), `bootstrap.sh` or `bootstrap.ps1` (the helper library of `lib/`, then each tool's variables followed by its script), the files the scripts use, and for Windows the Packer template (`packer.ts`). The output depends only on committed files, not on the machine or the environment.
- **An image's name is `<key>-<first 16 hex of the sha256 of that directory>`.** The key is the operating system or distro and the architecture (`linux-x64-debian`, `windows-aarch64`). Anything that changes what a bake does changes a byte of the directory, so it changes the name. There are no version numbers to bump and no commit tags.
- **`.buildkite/ci.ts`** generates every image, asks the cloud whether each name exists (`scripts/ci-image.ts`), and for a missing one uploads the directory as an artifact and emits a bake step, plus a wait step that the builds and tests depend on. A name that is already being baked by another build only gets the wait step. Every later build finds the image by name and bakes nothing.
- **Only builds of this repository's own branches can bake.** A bake runs the branch's code on a machine that becomes everyone's image, so a fork's build that needs a missing image fails with a message saying so.

## Commands

```sh
bun run ci:images                      # generate every image, print <name>  <directory>
bun run ci:images linux-x64-debian     # only these keys
less build/ci-images/linux-x64-debian/bootstrap.sh   # the whole bake, top to bottom
bun test test/internal/ci-images.test.ts test/internal/source-lints/ci-image-pins.test.ts
```

To see what a change does to an image, generate before and after and diff the two `bootstrap.*` files. If a name did not change, that image will not be rebaked.

## Common tasks

**Bump a version.** Edit the pin in `spec.ts`. If the pin has `sha256` values, replace them with the ones the new release publishes. Run the two tests above: the lint tells you if `rust-toolchain.toml` or a workflow has to move with it. Push; the build bakes the images whose names changed.

**Add a tool.** `tools/bun-ninja.ts` with its three scripts is a complete example (one tool, all three systems, a checksummed download):

1. `tools/<name>.ts`: the function. Compute URLs here. Return only the variables the script reads.
2. One script per system it runs on, under `tools/linux/`, `tools/windows/`, `tools/macos/`. If a distro needs a different script, name it `<name>.apt.sh` / `<name>.apk.sh` and pick in the function.
3. `spec.ts`: the pin, its entry in `locations` if it goes somewhere of its own (a binary in `/usr/local/bin` does not need one), and one line in each tool list, placed after whatever it needs (`unzip` comes from the packages tool, `node` from `nodejs`).

Nothing else changes: not `ci.ts`, not the generator.

**Change what a tool does.** Edit its script or its function. The images that include it get new names.

**Change or add an image.** Edit `images` in `spec.ts`. A base image is an exact name and owner (AWS) or an exact Marketplace version (Azure), never "latest": find them with `aws ec2 describe-images --owners <owner> --filters Name=name,Values='<pattern>'` and `az vm image list --publisher … --offer … --sku … --all`. A new image also needs a platform in `.buildkite/ci.ts` that matches its os, arch, distro and release. Two images cannot share a key; the key is also the directory.

**Bake an image again with nothing changed.** There is deliberately no switch for it in the repository. A build bakes a name that does not exist, so removing the image in the cloud is what makes the next build bake it.

**Read what is on an image.** Every bake writes `bun-image.json` on the machine (`/etc/`, `C:\`) and publishes it as the bake job's artifact `build/ci-images/<key>/bun-image.json`: the spec's facts, the image's name, and the exact version of every distro or Scoop package the bake got. It is for keying caches of build outputs; it never feeds the name.

## Rules for scripts

- A Linux script runs as root under `set -eu`, a Windows one under `$ErrorActionPreference = "Stop"`, a macOS one as the machine's admin user (Homebrew refuses root) with `sudo` for system paths. A failed command ends the bake.
- A script may read its tool's variables, the runtime variables (`$BAKE_DIR`, `$REPO_DIR`, `$IMAGE_NAME` on Linux; `$BAKE_DIR`, `$REPO_COMMIT`, `$IMAGE_NAME` on Windows), and the helpers of `lib/`. The generator refuses a script that reads an upper-case variable its tool does not provide, and a tool that provides one its script never reads.
- **A script installs. It does not check versions.** Comparing a tool's version with the spec is the build's job (`checkImageTools()` and `findLlvmTool()` in `scripts/build/tools.ts`, on a Buildkite agent). A script fails on: a download's checksum, where the publisher provides one; an installer's exit code; a lookup it cannot go on without.
- **Nothing is best-effort.** An image's name says what is on it, so an install that fails has to fail the bake. A swallowed failure would publish an incomplete image under the good name, and every later build would find that name and never bake again.
- Use `download` / `Download`, `add_to_path` / `Add-To-Path`, `set_env` / `Set-Env`; on Windows `Run` for native commands (PowerShell does not fail on a non-zero exit), `Install-Scoop-Package`, and `Remove-Temp` for temporary files.

## Things that are not obvious

- **What renames an image.** Files copied into the bake directory count byte for byte, comments included: the helper library and the tool scripts an image uses, `tools/record-image.mts`, `tools/windows/fetch-ssh-keys.ps1`, `scripts/build/xmac.mjs` (the build image only), and `scripts/agent.ts`, which is copied whole, so any edit to it rebakes all eight images. Code that computes the output (`spec.ts`, `tools/*.ts`, `generate.ts`, `image.ts`, `packer.ts`) only counts when the output changes. What the prefetch steps download (dependency versions, `bun.lock`, the test Docker images), what floats upstream under a fixed name, `.buildkite/ci.ts` and `scripts/ci-image.ts` never rename anything.
- **Windows bakes run under Windows PowerShell 5.1.** PowerShell 7 is one of the things the bake installs. No `&&`, `||`, `??`, ternaries, or PowerShell 7-only parameters (`Invoke-WebRequest -MaximumRetryCount`). Parsing the script under `pwsh` does not catch these.
- **Scoop puts an app's directories on the installing user's PATH**, and the agent's jobs run as another account. `Install-Scoop-Package` copies them to the machine's PATH; a tool that installs outside Scoop must `Add-To-Path` itself.
- **Scoop's manifests write errors that are not failures** (cleanup steps). `Install-Scoop-Package` runs Scoop with non-terminating errors and decides success by the app's directory existing.
- **The Windows bake step must be a single command.** With several, Buildkite runs them in a shell, and a cancel ends that shell without `ci-image.ts` or Packer seeing the signal, so Packer's VM is never deleted and keeps holding its cores. As one command, Packer hears the cancel and deletes the VM first; the hosted agent ends the job seconds later, so the VM's network and disk can be left behind. `bake-image` downloads its directory and uploads `bun-image.json` itself for this reason.
- **`/tmp` is a tmpfs on the Debian base image during the bake.** Anything that renames files from a scratch directory into `/opt` (xwin's `splat`) needs the scratch directory on the same filesystem.
- **Debian gives a user who is not root no sbin directory on PATH.** The test runner calls `sysctl` as the agent's user; the core-dumps tool puts `/sbin` on the job PATH.
- **Starting a service during a bake can leave machine identity in the image** (sshd writes host keys). Remove it before the image is taken.
- **A push cancels the branch's running build**, bakes included. A Linux bake takes 5 to 15 minutes and its snapshot another 20 to 35 to become available; a Windows bake takes about an hour.

## Testing a change before CI does

- `bun run ci:images`, then `shellcheck -s sh -S warning build/ci-images/<key>/bootstrap.sh`, and for Windows parse `bootstrap.ps1` with PowerShell's parser and run `packer validate -syntax-only` with exactly the pinned Packer version.
- A Linux script can be run for real in a container of the same distro: `tar -C build/ci-images/<key> -c . | docker run -i debian:13 sh -c 'mkdir /bake /checkout && tar -x -C /bake && sh /bake/bootstrap.sh /checkout some-name'` (the checkout is only read by the prefetch steps). A bare container has no init system (install `systemd` or `openrc` first), cannot start services (Docker, Tailscale), and cannot run the prefetch steps; stop before them. To test one tool, run `lib/linux.sh` plus that tool's section of the generated script.
- Windows and macOS scripts can only be run by a bake.

## Debugging a failed bake

The bake step's log is the script's output, and the script is linear: find the last `# ---- <tool> (tools/…)` banner before the error. For Windows the log is Packer's; the script's error is above Packer's cleanup lines, and `An error occurred:` is how Packer reports a PowerShell terminating error. A Windows step that fails within a minute with `InvalidTemplateDeployment … preflight validation` is Azure refusing the VM (usually quota held by VMs of cancelled bakes), not the script.

## macOS

`macosMachines` and `macosTools()` give the macOS test machines the same pinned Node.js, Bun, curl-h3, LLVM (through Homebrew) and Rust toolchain. CI does not bake or name them: `scripts/darwin-ci` clones the repository at `--ref` on the host, generates `build/ci-images/darwin-<arch>/bootstrap.sh` there, and runs it in the Tart guest image it builds (`bake`) or on a bare host (`provision … bare`). `bake` swaps the host's image only if the toolchain check passes. TODO for whoever sets up managed, ephemeral macOS machines: bake them like the others, named by hash.
