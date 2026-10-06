# CI machine images

CI's build and test machines start from images baked ahead of time: AWS AMIs for Linux, Azure Compute Gallery images for Windows. Everything about them is in one file, `spec.ts`: what exists, what is on it, how it gets there, and the generator that turns that into the scripts a bake runs. macOS test machines are described there too, but CI does not bake them (see [macOS](#macos)).

## How `spec.ts` is laid out

1. **The data.** `files` (the repository files copied onto machines), `pins` (every version), `locations` (where a bake puts what is not the operating system's to place), `images` (each with the exact base image it starts from), the package lists, and how Packer bakes a Windows image. The build system's own LLVM, Node.js, xwin, Windows SDK, macOS SDK, Android API level and FreeBSD versions import from `pins`, and its sysroot and cache lookups from `locations`; `test/internal/source-lints/ci-image-pins.test.ts` keeps what cannot import them in step: `rust-toolchain.toml`, the GitHub workflows, `scripts/darwin-ci` (copied to its hosts), `scripts/agent.ts` (runs on the machines alone) and the Node-API test harness.
2. **The tools.** A tool is one thing a bake sets up on the machine, whether it installs something (Bun, LLVM) or configures the system (`ulimits`, the agent's user). Each is a function of the image that returns its steps and its `identity` (how what it puts on the machine is known, for the image's record), and `tools(image)` at the end of the section is what a machine gets, in order.
3. **The machinery.** The vocabulary the tools are written in (values and steps), its sh and PowerShell renderers, the one small program a bake leaves on the machine, the Packer template, and `generateImage()`.

A tool does not contain shell, and neither does the machinery keep any in strings to call: there are no helper functions in the generated script. A step renders the lines themselves (a download is a `curl` line, putting a directory on PATH is the two lines that do it), so every line that runs is where it runs. A tool says what should be true (`download`, `unpack`, `installExecutable`, `directory`, `systemUser`, `service`, `registryValue`, `scheduledTaskAtStartup`, …) and the renderer says it in sh for Linux (as root), in sh with `sudo` where needed for macOS, or in PowerShell. One description serves every system a tool exists on: `bun` is one function for Linux, macOS and Windows.

## The generated script is what you read

```sh
bun run ci:images                      # generate every image, print <name>  <directory>
bun run ci:images linux-x64-debian     # only these keys
less build/ci-images/linux-x64-debian/bootstrap.sh   # the whole bake, top to bottom
bun test test/internal/source-lints/ci-images.test.ts test/internal/source-lints/ci-image-pins.test.ts
```

`build/ci-images/<key>/` holds `image.json` (what the image is), `bootstrap.sh` or `bootstrap.ps1`, the files the script puts on the machine, and for Windows the Packer template. The script is straight-line and has every value in it: a loop over things known in `spec.ts` (architectures, package names) is a loop in TypeScript, and the script only loops over what is known on the machine (a command's output, the files a pattern matches). It does not try to look hand-written. It is what CI runs, what gets linted, and what you read when a bake fails, and it generates the same anywhere: the output depends only on committed files.

**An image's name is `<key>-<first 16 hex of the sha256 of that directory>`.** The key is the operating system or distro and the architecture (`linux-x64-debian`, `windows-aarch64`). `.buildkite/ci.ts` generates every image, asks the cloud whether each name exists (`scripts/ci-image.ts`), and bakes the ones that do not; a name another build is already baking only gets a wait step. There are no version numbers to bump and no commit tags. Only builds of this repository's own branches can bake: a bake runs the branch's code on a machine that becomes everyone's image. A fork's build does not ask the cloud anything, so it reads none of the cloud's credentials: it uses the images that exist, and fails with an explanation if its diff touches a bake input (`bakeInputs`: `spec.ts` and the files listed in `files`).

**What renames an image:** a change to `spec.ts` that changes the generated directory (a comment or a refactor that leaves the output alone does not), and any byte of the files listed in `files`: `scripts/agent.ts`, which is copied whole onto every baked machine, and the vendored `scripts/build/xmac.mjs` on the build image. Nothing else: not `.buildkite/ci.ts`, not what the prefetch steps download (dependency versions, `bun.lock`, the test Docker images), not what floats upstream under a fixed name. To see what a change does, run `bun run ci:images` before and after and compare the names.

## Common tasks

**Bump a version.** Edit the pin. If it has `sha256` values, replace them with the ones the new release publishes. Run the two tests: the lint says if `rust-toolchain.toml` or a workflow has to move with it.

**Add a tool.** Write a function in section 2 and add it to `tools()` after whatever it needs. It does not compile without an `identity` (see below). `bunNinja` is a complete example: a pin with the release's published checksums, a location, and one call that serves all three systems. A download is one of three composites: `unpackedArchive` (an archive into a directory), `executableFromArchive` (one program out of an archive, installed) and `runInstallerScript` (a publisher's own installer).

**Need something the vocabulary lacks.** Add a function to section 3. It takes what it needs as values and returns the lines for each shell. Keep it about intent (`firewallAllowInbound`, not a cmdlet's parameter list at every call site), and add it once it is needed, not before. `run` and `cmdlet` call any program; program text for another tool (an awk program, a sed expression) is a string argument.

**Change or add an image.** Edit `images`. A base image is an exact name and owner (AWS) or an exact Marketplace version (Azure), never "latest": find them with `aws ec2 describe-images --owners <owner> --filters Name=name,Values='<pattern>'` and `az vm image list --publisher … --offer … --sku … --all`. A new image also needs a platform in `.buildkite/ci.ts` that matches its os, arch, distro and release. Two images cannot share a key; the key is also the directory.

**Refresh what is prefetched.** What the `prefetch` tool downloads (dependency sources for the build, the test Docker images, `bun install`'s cache) is decided by the commit being built, which it clones for that and removes, so a dependency bump does not rename an image: the images keep working and their caches miss more over time (a build log says `using prefetch cache` for a hit and `fetching` for a miss). Raise `prefetchTriggerVersion`. The number is written into the `prefetch` tool's section of the generated scripts, which renames every baked image, and the next build bakes them all. It means nothing else.

**Bake one image again with nothing changed.** There is deliberately no switch for it. A build bakes a name that does not exist, so removing the image in the cloud is what makes the next build bake it.

**Read what is on an image.** Every bake writes the image's record, `bun-image.txt`, on the machine (`/etc/`, `C:\`) and publishes it as the bake job's artifact `build/ci-images/<key>/bun-image.txt`: the image's name, the spec's facts, a line for every tool saying how what it puts on the machine is known, what the observed tools printed, and every entry of the distro's or Scoop's package database. The bake script writes it with ordinary steps in either shell; the `recordImage` tool in `spec.ts` has the format. It is for keying caches of build outputs (same bytes, same machine content), so nothing in it may differ between two identical machines: no times, hostnames or instance ids. It never feeds the name.

## A tool's identity

The name covers everything `spec.ts` decides; the record adds what is only decided on the day of the bake. So that adding or removing a tool cannot leave the record wrong, `Tool` requires an `identity`, and `tsc` refuses a tool without one:

- `pinned(value)`: known in this file (a version, a tag). The value is written into the record as it is.
- `observed(step)`: only known on the machine. The step is rendered into the script right after the tool's own steps, and what it prints is the record; a tool that observed nothing fails the bake. `treeDigest(...directories)` is the step for something with no version to ask for, like the glibc and musl sysroots, whose packages are whatever the distro serves that day.
- `packageDatabase`: it arrives through apt, apk, Scoop or Homebrew (also when a publisher's installer script is what calls apt, as Docker's, Tailscale's and LLVM's do). The record lists that database with exact versions.
- `configuration`: nothing arrives from outside; this file decides all of it.
- `notRecorded(reason)`: deliberately outside the record. The `prefetch` tool is: what it fetches is decided by the commit being built.

## Rules

- **A tool installs. It does not check versions.** Comparing a tool's version with the pin is the build's job, in `scripts/build/tools.ts`: `findLlvmTool()` accepts only the pinned LLVM release series on every machine, and `checkImageTools()` compares `bun`, `cmake` and `node` exactly on a Buildkite agent. A bake fails on a download's checksum, where the publisher provides one; on a program's or installer's exit code; on a lookup it cannot go on without.
- **Nothing is best-effort.** An image's name says what is on it, so an install that fails has to fail the bake. A swallowed failure would publish an incomplete image under the good name, and every later build would find that name and never bake again.
- **Downloads go to `scratch(…)`.** A tool that uses it gets a directory made before its steps and removed after them, on the disk: `/tmp` is a tmpfs on the Debian base image while it is baked.
- **In a tool, paths are written with `/`**, also Windows ones (`C:/Windows/System32`); the PowerShell renderer turns a drive, registry or machine-known path into `\`. `locations` keeps `\` for Windows, because the build system and `.buildkite/ci.ts` use those strings as they are, and the renderer accepts both.
- **On macOS `sudo` is decided by the path written**: an absolute path gets it, except under `/opt/homebrew`, which belongs to the user. The script runs as the machine's admin user, because Homebrew refuses root. On an Intel Mac Homebrew's prefix is `/usr/local`, which is also where the system's own programs go, so writes there get `sudo`.

## Things that are not obvious

- **Windows bakes run under Windows PowerShell 5.1.** PowerShell 7 is one of the things the bake installs. What the renderer emits must not use `&&`, `||`, `??`, ternaries, or PowerShell 7-only parameters. A cmdlet's failure ends the script (`$ErrorActionPreference = "Stop"`), but a native program only reports through its exit code, so `render` follows every statement that ran one with a check of `$LASTEXITCODE`; a step that emits several statements has to render them through `render` for each to get its check. Downloads use `curl.exe`, spelled that way because 5.1 calls `Invoke-WebRequest` `curl`. Parsing the script under `pwsh` does not catch these.
- **Scoop puts an app's directories on the installing user's PATH**, and the agent's jobs run as another account, so `scoopInstall` copies them to the machine's PATH. Scoop's manifests also write errors that are not failures, so it runs Scoop with errors not ending the script and decides success by the app's directory existing.
- **`perl` on Windows is the one inside Git.** Strawberry Perl would come first on PATH and write text files with CRLF.
- **The Windows bake step must be a single command.** With several, Buildkite runs them in a shell, and a cancel ends that shell without `ci-image.ts` or Packer seeing the signal, so Packer's VM is never deleted and keeps holding its cores. As one command, Packer hears the cancel and deletes the VM first; the hosted agent ends the job seconds later, so the VM's network and disk can be left behind.
- **Debian gives a user who is not root no sbin directory on PATH.** The test runner calls `sysctl` as the agent's user; the core-dumps tool puts `/sbin` on the job PATH.
- **Starting a service during a bake can leave machine identity in the image** (sshd writes host keys). Remove it before the image is taken.
- **A push cancels the branch's running build**, bakes included. A Linux bake takes 5 to 15 minutes and its snapshot another 20 to 35 to become available; a Windows bake takes about an hour.

## Testing a change before CI does

- `bun run ci:images`, read the script, then `shellcheck -s sh -S warning build/ci-images/<key>/bootstrap.sh`; for Windows parse `bootstrap.ps1` with PowerShell's parser and run `packer validate -syntax-only` with exactly the pinned Packer version.
- A Linux script can be run for real in a container of the same distro: `tar -C build/ci-images/<key> -c . | docker run -i debian:13 sh -c 'mkdir /bake && tar -x -C /bake && sh /bake/bootstrap.sh <commit> some-name'`. A bare container has no init system (install `systemd` or `openrc` first), cannot start services (Docker, Tailscale), and cannot run the `prefetch` tool past its clone; cut the script before it.
- Windows and macOS scripts can only be run by a bake. After one, compare its `bun-image.txt` with the previous bake's.

## Debugging a failed bake

The bake step's log is the script's output, and the script is linear: find the last `# ---- <tool>` banner before the error, then read that section of the generated script. For Windows the log is Packer's; the script's error is above Packer's cleanup lines, and `An error occurred:` is how Packer reports a PowerShell terminating error. A Windows step that fails within a minute with `InvalidTemplateDeployment … preflight validation` is Azure refusing the VM (usually quota held by VMs of cancelled bakes), not the script.

## macOS

`macosMachines` and the `darwin` branch of `tools()` give the macOS test machines the same pinned Node.js, Bun, curl-h3, LLVM (through Homebrew) and Rust toolchain. CI does not bake or name them: `scripts/darwin-ci` clones the repository at `--ref` on the host, generates `build/ci-images/darwin-<arch>/bootstrap.sh` there, and runs it in the Tart guest image it builds (`bake`) or on a bare host (`provision … bare`). `bake` swaps the host's image only if the toolchain check passes. TODO for whoever sets up managed, ephemeral macOS machines: bake them like the others, named by hash.
