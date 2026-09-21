# darwin CI agents

Provisioning for the macOS test agents on queue `test-darwin`.

Two modes:

- `tart`: for Apple Silicon hosts with memory to spare. The host runs only
  `buildkite-agent` and [Tart](https://tart.run); every test job runs in a
  fresh macOS guest cloned from a baked image and deleted afterwards.
- `bare`: for Intel hosts (Tart cannot virtualize macOS on Intel) and small
  Apple Silicon hosts. The bun toolchain and `scripts/agent.ts` service run
  on the host itself.

Agents tag themselves `os=darwin arch=... release=<macOS major> release-tier=...`
and `.buildkite/ci.ts` selects on those. In tart mode `release` is the
guest's macOS version, and a guest cannot be newer than its host.

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
session), bakes the guest image from a public base image plus the toolchain
script generated from `scripts/build/ci-images/spec.ts`, and starts the agent as that user with `hooks/` as
its hooks path. It asks for one reboot the first time and is re-run after it.

`provision <hostname> bare` does the same host setup, then runs that generated
script on the host and installs the `scripts/agent.ts` service.

The script is `build/ci-images/darwin-<arch>/bootstrap.sh`, written by
`scripts/build/ci-images/spec.ts` from a checkout of `--ref` on the host.
The versions it installs are the ones every other CI machine gets.

`bake` is safe on a live host: it builds a staging image and swaps it in only
after the toolchain verifies. Re-run it when toolchain pins move.

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
command again, and check the agent appears under `queue=test-darwin`.

## Removing a host

Unload the agent (`launchctl bootout` the `com.buildkite.buildkite-agent`
job), drop the host from the token allowlist and the tailnet, and release it.
Nothing on a host needs preserving.
