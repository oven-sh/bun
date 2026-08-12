# darwin CI agents

Provisioning for the macOS test agents on queue `test-darwin`.

Two modes:

- `tart`: for Apple Silicon hosts with memory to spare. The host runs only
  `buildkite-agent` and [Tart](https://tart.run); every test job runs in a
  fresh macOS guest cloned from a baked image and deleted afterwards.
- `bare`: for Intel hosts (Tart cannot virtualize macOS on Intel) and small
  Apple Silicon hosts. The bun toolchain and `scripts/agent.mjs` service run
  on the host itself.

Agents tag themselves `os=darwin arch=... release=<macOS major> release-tier=...`
and `.buildkite/ci.mjs` selects on those. Every build schedules one darwin
aarch64 test job per tier (`release-tier=latest` and `release-tier=previous`),
so the fleet needs agents on both; a tier with too few agents backs up until
PR jobs expire unrun. In tart mode `release` is the guest's macOS version, and
a guest cannot be newer than its host.

A tart host therefore bakes one image per guest release in `lib/config.ts`
(`bun-ci-26` for `latest`, `bun-ci-15` for `previous`) and runs one agent per
image, so each host serves both lanes; the command hook boots the image for
the agent's `release` tag. `--release N` restricts a host to one image (a host
still on an older macOS, or without disk for two images); `--spawn N` sets the
agents, i.e. concurrent guests, per image.

## Layout

```
host.sh            first contact: installs brew and bun, then runs `main.ts provision`
main.ts            provision | setup-user | bake | install-agent
lib/               host hardening, tailscale, the unprivileged CI user, tart, bake, agent config
hooks/             agent hooks for tart hosts (command, pre-exit, environment)
guest/bake.sh      runs inside the guest once, at bake time
guest/job.sh       runs inside the guest for every job
```

`provision <hostname> tart` disables remote management, makes sshd key-only,
joins the tailnet, installs `buildkite-agent` and Tart, creates an
unprivileged auto-login user (Virtualization.framework needs a console
session), bakes the guest images from their public base images plus
`scripts/bootstrap.sh`, and starts the agents as that user with `hooks/` as
their hooks path. It asks for one reboot the first time and is re-run after it.

`provision <hostname> bare` does the same host setup, then runs
`scripts/bootstrap.sh` on the host and installs the `scripts/agent.mjs` service.

`bake` is safe on a live host: it builds a staging image and swaps it in only
after the guest's macOS major matches the image's release and the toolchain
verifies. Re-run it when toolchain pins move, or with `--release N` for one
image. `install-agent` retires whatever agents the host had (including the
single `com.buildkite.buildkite-agent` job from before images were
per-release) before installing one per image; a host from that era also still
has the old `bun-ci-base` image to `tart delete`.

## Bringing up a host

Prerequisites on a freshly imaged host: an admin account you can ssh into
with a key, passwordless sudo for it, the host's address on the agent
token's IP allowlist, and the agent token written to the root-only file named
in `lib/config.ts` (or `DARWIN_CI_TOKEN_FILE`).

```sh
scp -r scripts/darwin-ci <admin>@<host>:
ssh <admin>@<host> 'darwin-ci/host.sh <hostname> tart --tags <tailscale tags>'
```

Approve the Tailscale login it prints, reboot when it asks, run the same
command again, and check that `queue=test-darwin` gains one agent per image
(`<hostname>-tart-26-1` and `<hostname>-tart-15-1`), one tagged with each
`release-tier`.

## Removing a host

Unload the agents (`launchctl bootout` each `com.buildkite.buildkite-agent.*`
job), drop the host from the token allowlist and the tailnet, and release it.
Nothing on a host needs preserving.
