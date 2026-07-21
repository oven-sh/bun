# CI machine images

How the machines Bun's CI runs on get built, named, and kept in sync with
the repo. This directory is the whole system: what an image contains, how it
is baked, and how CI finds it.

## The idea in one paragraph

Every CI image (an AWS AMI for Linux, an Azure gallery image for Windows) is
**content-addressed**: its name is `${key}-${hash}`, where the hash digests the
image's entry in `spec.ts` plus every download URL that entry resolves to.
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

| file                                                 | role                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec.ts`                                            | **The single source of truth.** Pure data: one typed entry per image (`LinuxBuildHostImage`, `LinuxTestImage`, `WindowsX64Image`, `WindowsArm64Image`) — a complete manifest of what's baked on that machine (versions, package lists, cross toolchains, base image, bake shape, system tuning). Facts shared between images (the Node.js version, LLVM, …) are declared once and referenced. |
| `types.ts`                                           | The types for the spec. The types are the checklist: a field only some images bake exists only on those images' types.                                                                                                                                                                                                                                                                        |
| `artifacts.ts`                                       | Turns spec values into concrete `{url, sha256}` downloads. `resolveArtifacts(entry)` is THE enumeration of everything an image bake fetches. Code, not data — but its _output_ is hashed.                                                                                                                                                                                                     |
| `naming.ts`                                          | The hash and the name. `imageHash(entry)` = `sha256({epoch, image, artifacts})`.                                                                                                                                                                                                                                                                                                              |
| `bootstrap.ts`                                       | Entry point run **on the bake VM** under a bare `node` (type stripping). `node bootstrap.ts --image=<key> --ci --repo-ref=<ref>`. `--dry-run` prints the complete plan for any image from any host.                                                                                                                                                                                           |
| `components/*.ts`                                    | One file per baked thing (nodejs, ccache, the sysroots, ...): each owns HOW its thing installs on each platform it supports and enumerates its own downloads, reading every fact from the spec entry.                                                                                                                                                                                         |
| `components/registry.ts`                             | name → component; derives BOTH the ordered install steps and the hashed download bundle from an image\'s `components` list, so what is baked and what is hashed share one input.                                                                                                                                                                                                              |
| `components/paths.ts`                                | Derived locations composed from the spec\'s root paths; no path is written twice.                                                                                                                                                                                                                                                                                                             |
| `bootstrap/ops-posix.ts`, `bootstrap/ops-windows.ts` | The vocabulary: `ensureDirectory`, `installFile`, `extractArchive`, `ensureSystemUser`, `msiInstall`, `setMachineEnv`, … Each op logs its intent then the exact command.                                                                                                                                                                                                                      |
| `bootstrap/runtime.ts`                               | Logging, `run`/`sudo`, `download` (checksum-verified), dry-run, and the failure report.                                                                                                                                                                                                                                                                                                       |
| `packer.ts`                                          | Renders the Windows Packer template as JSON from a `WindowsImage` entry (no checked-in `.pkr.hcl`).                                                                                                                                                                                                                                                                                           |
| `delivery.ts`                                        | The shim `machine.mjs` runs on a fresh box: fetch the spec-pinned node, then `node bootstrap.ts`.                                                                                                                                                                                                                                                                                             |

## Common tasks

**Bump a tool** (say LLVM): edit `llvm.version` / `llvm.major` in `spec.ts`.
Every image that references `llvm` gets a new hash and re-bakes on your PR.
Nothing else to touch.

**Add or remove a package**: edit the relevant `packages` list on the
image entry (or the shared list it references) in `spec.ts`.

**Change how something is installed** (a URL layout, a tarball format):
edit the builder in `artifacts.ts`. The resolved URLs are part of the hash,
so exactly the images whose downloads changed re-bake.

**Change bootstrap logic without changing any fact** (a fix in
`linux.ts`, a change to `agent.mjs`): the hashes do NOT change and existing
images are reused — recipe code is deliberately outside the hash so a comment
edit never triggers an hour-long bake. When such a change _must_ reach the
images, bump `epoch` in `spec.ts`. That is the one manual step left, and
it is intentional.

**Add an image**: add an entry to `images` in `spec.ts` (the type tells you
every field you owe), and map a CI platform to it in `.buildkite/ci.mjs`.

**Review what a bake will do**, without touching anything:

```sh
node scripts/build/ci/bootstrap.ts --image=linux-aarch64-13-debian --ci --repo-ref=main --dry-run
```

Prints every step, every command, every download (URL + whether it is
checksum-pinned), and every file write. Works from any OS.

**Check the whole fleet at once** (`bun run ci:images`): prints all 8
content-addressed names and dry-runs every image's plan, failing loudly on
the first one that can't. `node scripts/build/ci/check.ts`.

## How a bake happens

1. `.buildkite/ci.mjs` (running on `queue=build-image`, which holds the
   cloud credentials) computes `imageName(key)` for all 8 images, asks each
   image's cloud whether that exact name exists (`existence.ts`), prints the
   table into the `:pipeline:` job log, and emits a **`ensure image`** step
   **only for the missing ones**, plus `image-name=<name>` on every agent
   block. A push that changes nothing emits no bake steps at all.
2. `scripts/machine.mjs create-image --image=<key>` re-checks the exact
   name before launching anything (the guard against two simultaneous
   builds of one new hash) and returns immediately if it exists — same
   name means same recipe. Otherwise it bakes.
3. Linux: launch the base AMI (spec `base.nameGlob`), upload
   `scripts/build/ci/`, run the shim from `delivery.ts` (curl the pinned
   node, `node bootstrap.ts …`), snapshot as `<name>`.
   Windows: `packer.ts` renders the JSON template; Packer creates the VM,
   the provisioners fetch the pinned node and run `bootstrap.ts`, then
   sysprep and gallery publish under `<name>`.
4. robobun launches CI machines by looking `<name>` up exactly. No
   wildcards, no newest-wins.

## What the hash means (and doesn't)

The hash means **same recipe**, not **same bytes**. Some inputs float by
nature and are marked `FLOATING` in `spec.ts`: OS package repositories
(apt/apk/scoop serve current versions), `latest` cloud base images, installer
scripts served from a fixed URL (`get.docker.com`, `sh.rustup.rs`, Scoop,
the VS bootstrapper). A pinned `sha256` makes a download exact; `sha256:
null` marks it FLOATING and it is fetched-but-unverified by design.

If a floating input drifts underneath us in a way that breaks the image —
the URL string is identical so the artifact bundle can't see it — bump
`epoch`. Pinning more checksums shrinks how often that's needed.

## Design rules (please keep them)

- **`spec.ts` is pure data.** No functions, no `?? default` guesses. If a
  value can change what an image contains and it isn't in the spec, that is
  a bug — move it in.
- **Nothing re-declares a spec value.** `winsysroot.ts`, `macos-sdk.ts`, and
  `ci.mjs` import their pins from the spec; a "keep in sync with X" comment
  is a smell that means "import it instead."
- **`resolveArtifacts` is the one list of downloads.** The step code reads
  its `Download`s from the resolved bundle (`ctx.artifacts.…`), never by
  calling a URL builder itself, so what is hashed and what is fetched are
  the same object.
- **Ops over shell strings.** Steps compose ops; the few genuine scripts use
  `shellScript`/`powershellScript` with a required `describe`, so raw script
  is a labeled exception, not the norm.
- **Verbose output, tight code.** Every step is named and timed, every
  command echoed with its output, every download logged with size and
  checksum outcome, every failure reported with step + command + exit code
  - output. The bake log is the only artifact left when a build fails an
    hour in.
