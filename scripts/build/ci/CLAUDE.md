# CI machine images — how this system works

This is the guidance document for `scripts/build/ci` (loaded when working in
this directory). Read it before changing anything here: it explains the design,
the invariants that must not be broken, and how to make the common changes.

How the machines Bun's CI runs on get built, named, and kept in sync with
the repo. This directory is the whole system: what an image contains, how it
is baked, and how CI finds it.

## The idea in one paragraph

Every CI image (an AWS AMI for Linux, an Azure gallery image for Windows) is
**content-addressed**: its name is `${key}-${hash}`, where the hash digests the
image's entry value in the spec (canonically serialized).
Change what an image contains → its hash changes → the branch that changed
it bakes a fresh image once, and every later push — including `main` after
you merge — computes the same hash and reuses it. There is no
`[build images]` commit tag, no `[publish images]` step, and no version
number to bump anywhere. Merging _is_ publishing.

## Prerequisites

- **The pipeline generator brings its own node.** The `:pipeline:` step runs
  `node .buildkite/ci.mjs`, a plain-JavaScript wrapper (startable under any
  node) that reads `nodejs.version` from `spec.ts`, downloads that exact
  Node.js for the running host (cached in `~/.cache/bun-ci-node`, so it
  fetches once per host), and spawns the real generator
  `.buildkite/ci.ts` under it — the standing agent\'s own node is never
  used. `ci.ts` and the modules it imports need node >= 25 (type
  stripping); the spec pins 26.x, the same node baked onto the images.
  (`.buildkite/generate-pipeline.sh` is the equivalent standalone shim, for
  when this becomes the direct entry point.)
- The `build-image` queue holds the AWS + Azure credentials `machine.mjs`
  already uses; `ci.mjs`\'s existence check reads the same secrets there.
- The `aws` CLI on that queue (the AWS existence check shells out to it).

## The files

| file                                             | role                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.ts`, `spec.linux.ts`, `spec.windows.ts`    | **The single source of truth.** Pure data. `spec.ts` holds the facts every image references, declared once (the Node.js version, bun, LLVM, cross toolchains, packer pins); `spec.linux.ts` / `spec.windows.ts` hold the per-platform entries — one typed entry per image (`LinuxBuildHostImage`, `LinuxTestImage`, `WindowsX64Image`, `WindowsArm64Image`), a complete manifest of what's baked. |
| `images.ts`                                      | The assembled fleet (`images`, `buildHost`) from the two platform specs, for consumers that need every image.                                                                                                                                                                                                                                                                                     |
| `naming.ts`                                      | The name: `${key}-${imageHash(entry)}` — sha256 of the entry's value, canonically serialized.                                                                                                                                                                                                                                                                                                     |
| `existence.ts`                                   | Asks AWS/Azure whether each content-addressed name exists; the pipeline bakes only the missing ones.                                                                                                                                                                                                                                                                                              |
| `packer.ts`                                      | Renders the Windows Packer template as JSON from a `WindowsImage` entry at bake time (no checked-in `.pkr.hcl`).                                                                                                                                                                                                                                                                                  |
| `machine/bootstrap.ts`                           | The bake entry point run **on the machine** under a bare `node`: `node bootstrap.ts --image=<key> --ci --repo-ref=<ref>`. `--dry-run` prints the complete plan for any image from any host.                                                                                                                                                                                                       |
| `machine/artifacts.ts`                           | Turns spec values into concrete `{url, sha256}` downloads.                                                                                                                                                                                                                                                                                                                                        |
| `machine/runtime.ts`                             | Logging, `run`/`sudo`, `download` (checksum-verified), dry-run, and the failure report.                                                                                                                                                                                                                                                                                                           |
| `machine/ops-posix.ts`, `machine/ops-windows.ts` | The vocabulary: `ensureDirectory`, `installFile`, `extractArchive`, `ensureSystemUser`, `msiInstall`, `setMachineEnv`, … Each op logs its intent then the exact command.                                                                                                                                                                                                                          |
| `machine/components/{linux,windows}/*.ts`        | One file per baked thing, per platform: each owns HOW its thing installs and enumerates its own downloads, reading every fact from the spec entry. A thing on both platforms is two components sharing a name (`linux/nodejs.ts`, `windows/nodejs.ts`).                                                                                                                                           |
| `machine/components/linux/package-manager.ts`    | apt vs apk, abstracted once (`PackageManager`); an image's bundle imports only its own manager.                                                                                                                                                                                                                                                                                                   |
| `machine/components/registry.ts`                 | name → component per platform, and the derivations that walk an image's `components` list: the ordered install steps and the download bundle, from one input.                                                                                                                                                                                                                                     |
| `machine/components/paths.ts`                    | Derived locations composed from the spec's root paths; no path is written twice.                                                                                                                                                                                                                                                                                                                  |

## What we provision

Eight images, all in `images` from `images.ts` (`node scripts/build/ci/naming.ts` prints their
current names). Linux images are AWS AMIs; Windows are Azure gallery images.

| key                                   | os / arch                | role                                                                                  |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `linux-aarch64-13-debian`             | debian 13, arm64         | **build host** — bakes every cross toolchain (NDK, glibc/musl/windows/macos sysroots) |
| `linux-x64-13-debian`                 | debian 13, x64           | test                                                                                  |
| `linux-{x64,aarch64}-2504-ubuntu`     | ubuntu 25.04             | test                                                                                  |
| `linux-{x64,aarch64}-323-alpine-musl` | alpine 3.23 (musl)       | test                                                                                  |
| `windows-x64-2019`                    | Windows Server 2019, x64 | build + test                                                                          |
| `windows-aarch64-11`                  | Windows 11, arm64        | build + test                                                                          |

## How do I…

Every change below is a **fact edit**. Editing an image's entry moves its
hash, so it bakes once on your PR and is reused after — you never bump a
version or force a rebuild by hand. Sanity-check by dry-running an image (see below;
8 plans in about a second) before pushing.

| Task                                         | Where                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bump a dep version**                       | its `version` in `spec.ts` (shared facts like `llvm`, `nodejs`, `bun` are declared once and fan out)                                                                                        |
| **Add / remove a package** (apt, apk, Scoop) | the package list in `spec.ts`                                                                                                                                                               |
| **Add a whole new tool**                     | new `components/<tool>.ts` (how to install) + register it in `components/registry.ts` + add its name to the image's `components` list in `spec.ts` (install order) + its facts on the entry |
| **Remove a tool**                            | delete its name from the `components` list in `spec.ts`                                                                                                                                     |
| **Change a download's mirror / host**        | the base-URL fact in `spec.ts` (e.g. `nodejs.distBase`)                                                                                                                                     |
| **Change a download's URL scheme**           | the builder in `machine/artifacts.ts`, then bump the affected pin in the spec (only spec values move the hash; a code-only edit renames nothing)                                            |
| **Set the work / checkout dir**              | `paths.workDir` on that platform's entry (linux and windows are separate facts)                                                                                                             |
| **Set a cache dir, or turn a cache off**     | `paths.caches.{prefetch,install}` — a path enables it, `null` disables it                                                                                                                   |
| **Turn an optional feature on / off**        | its nullable config block on the entry (`null` = off). This is the idiom — Dev Drive would be `devDrive: {...} \| null` if added                                                            |
| **Reorder install steps**                    | reorder the `components` list — order is data (VS Build Tools before cargo, ci-user before prefetch)                                                                                        |

**Review what a bake will do** without touching anything:

```sh
node scripts/build/ci/machine/bootstrap.ts --image=linux-aarch64-13-debian --ci --repo-ref=main --dry-run
```

Prints every step, command, download (URL + whether checksum-pinned), and
file write. Works from any OS.

## How a bake happens

1. `.buildkite/ci.mjs` (running on `queue=build-image`, which holds the
   cloud credentials) computes `imageName(key)` for all 8 images, asks each
   image's cloud whether that exact name exists (`existence.ts`), prints the
   table into the `:pipeline:` job log, and emits a **`build image`** step
   **only for the missing ones**, plus `image-name=<name>` on every agent
   block. A push that changes nothing emits no bake steps at all.
2. `scripts/machine.mjs create-image --image=<key>` re-checks the exact
   name before launching anything (the guard against two simultaneous
   builds of one new hash) and returns immediately if it exists — same
   name means same recipe. Otherwise it bakes.
3. Linux: launch the base AMI (spec `base.nameGlob`), upload
   `scripts/build/ci/`, fetch the pinned node, run
   `node bootstrap.ts --image=<key> ...`, snapshot as `<name>`.
   Windows: `packer.ts` renders the JSON template; Packer creates the VM,
   uploads `scripts/build/ci/`, runs `bootstrap.ts --image=<key>`, then
   sysprep and gallery publish under `<name>`.
4. robobun launches CI machines by looking `<name>` up exactly. No
   wildcards, no newest-wins.

## What the hash means (and doesn't)

The hash is a digest of the image's **entry value** — its record from the
spec, canonically serialized (sorted keys, no whitespace) and sha256'd. It is
the value, not the source text: a comment, a reformat, or a key reorder
renames nothing. Any node process computes the same name from the checked-in
spec, so the pipeline and the bake job always agree.

The hash means **same recipe**, not **same bytes**. Some inputs float by
nature and are marked `FLOATING` in `spec.ts`: OS package repositories
(apt/apk/scoop serve current versions), `latest` cloud base images, installer
scripts served from a fixed URL (`get.docker.com`, `sh.rustup.rs`, Scoop,
the VS bootstrapper). A pinned `sha256` makes a download exact; `sha256:
null` marks it FLOATING and it is fetched-but-unverified by design.

If a floating input drifts underneath us in a way that breaks the image —
the URL string is identical so the value can't see it — pin its checksum
(or change any fact in the entry) so the value changes and it rebakes.
Pinning more checksums shrinks how often that happens.

## Design rules (please keep them)

- **`spec.ts` is pure data.** No functions, no `?? default` guesses. If a
  value can change what an image contains and it isn't in the spec, that is
  a bug — move it in.
- **Nothing re-declares a spec value.** `winsysroot.ts`, `macos-sdk.ts`, and
  `ci.mjs` import their pins from the spec; a "keep in sync with X" comment
  is a smell that means "import it instead."
- **Only spec values move the hash.** The name digests the entry's
  value and nothing else — not the recipe code, not the URL builders. A
  code-only change (a fixed component, a changed URL template) renames no
  image; to ship it, change a value in the affected entry (bump a pin,
  a version, or add the fact that changed) so the entry, and therefore the
  name, is different.
- **Ops over shell strings.** Steps compose ops; the few genuine scripts use
  `shellScript`/`powershellScript` with a required `describe`, so raw script
  is a labeled exception, not the norm.
- **Verbose output, tight code.** Every step is named and timed, every
  command echoed with its output, every download logged with size and
  checksum outcome, every failure reported with step + command + exit code
  - output. The bake log is the only artifact left when a build fails an
    hour in.
