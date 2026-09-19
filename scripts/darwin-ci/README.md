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
and `.buildkite/ci.mjs` selects on those. In tart mode `release` is the
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
session), bakes the guest image from a public base image plus
`scripts/bootstrap.sh`, and starts the agent as that user with `hooks/` as
its hooks path. It asks for one reboot the first time and is re-run after it.

`provision <hostname> bare` does the same host setup, then runs
`scripts/bootstrap.sh` on the host and installs the `scripts/agent.mjs` service.

`bake` is safe on a live host: it builds a staging image and swaps it in only
after the toolchain verifies. Re-run it when toolchain pins move.

## Reboots

Every host reboots nightly (the `com.buildkite.cleanup` launchd job).

A `bare` host on macOS 26 or later can also reboot at the start of a test job.
It keeps one kernel between jobs, and macOS does not free every TCP socket the
test suite closes: `sysctl net.inet.tcp.pcbcount` grows by about 1,000 per job
while netstat shows nothing. macOS 26 caps TCP memory at 1/32 of RAM, so an
8 GB host loses its network after about 60 jobs. When the count is over
`getDarwinLeakedSocketLimit()` (`scripts/utils.mjs`, 5,000 per GiB of RAM),
the job reboots the host instead of running tests, and Buildkite retries it
on another agent. The job log says so. `tart` guests are fresh for every job
and never do this.

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
