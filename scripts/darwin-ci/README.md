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
after the toolchain verifies, under the same lock the command hook clones
with. Re-run it when toolchain pins move.

Everything here runs on whatever bun `host.sh` pinned when the host was first
provisioned, so it sticks to `Bun.spawn` with argv arrays and stays off
`Bun.$`.

## Reboots

Every host reboots nightly (the `com.buildkite.cleanup` launchd job).

A `bare` host keeps one kernel between jobs, and macOS does not free every TCP
socket the test suite closes: `sysctl net.inet.tcp.pcbcount` grows by about
1,000 per job while netstat shows nothing. Every test job on a `bare` host
prints that count and the uptime when it starts.

macOS 26 caps TCP memory at 1/32 of RAM, so an 8 GB host loses its network
late in a busy day. On macOS 26 or later, a job that starts over
`getDarwinLeakedSocketLimit()` (`scripts/agent.ts`: about 20,000 on 8 GB and
85,000 on 16 GB) says in its log that the host needs a reboot.

The job reboots the host only when it has `BUN_RUNNER_REBOOT_DARWIN_AGENT=1`.
Nothing sets that yet: to turn it on, add it to the `env` of the test step in
`.buildkite/ci.ts`. The job then runs `sudo -n shutdown -r now` instead of the
tests. The shutdown stops the agent, which ends the job as `agent_stop`, and
the pipeline retries that on another agent.

With the reboot turned on, there are three cases where the job runs its tests
and leaves a warning annotation that names the host:

- The host does not reboot within five minutes. Reboot it by hand.
- `who` shows a remote login. `who` lists interactive sessions only. An ssh
  command that runs without a terminal is not in it, so it does not hold off
  a reboot, and nothing on the host shows that it ran.
- The host booted less than an hour ago. It cannot leak that much in an hour,
  so the count or the limit is wrong.

The beta lane has no automatic retry, so its host never reboots this way.
`tart` guests are fresh for every job.

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
