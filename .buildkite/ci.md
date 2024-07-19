## CI

How does CI work?

### Building

Bun is built on macOS, Linux, and Windows. The process is split into the following steps, the first 3 of which are able to run in parallel:

#### 1. `build-deps`

Builds the static libaries in `src/deps` and outputs a directory: `build/bun-deps`.

- on Windows, this runs the script: [`scripts/all-dependencies.ps1`](scripts/all-dependencies.ps1)
- on macOS and Linux, this runs the script: [`scripts/all-dependencies.sh`](scripts/all-dependencies.sh)

#### 2. `build-zig`

Builds the Zig object file: `build/bun-zig.o`. Since `zig build` supports cross-compiling, this step is run on macOS aarch64 since we have observed it to be the fastest.

- on macOS and Linux, this runs the script: [`scripts/build-bun-zig.sh`](scripts/build-bun-zig.sh)

#### 3. `build-cpp`

Builds the C++ object file: `build/bun-cpp-objects.a`.

- on Windows, this runs the script: [`scripts/build-bun-cpp.ps1`](scripts/build-bun-cpp.ps1)
- on macOS and Linux, this runs the script: [`scripts/build-bun-cpp.sh`](scripts/build-bun-cpp.sh)

#### 4. `link` / `build-bun`

After the `build-deps`, `build-zig`, and `build-cpp` steps have completed, this step links the Zig object file and C++ object file into a single binary: `bun-<os>-<arch>.zip`.

- on Windows, this runs the script: [`scripts/buildkite-link-bun.ps1`](scripts/buildkite-link-bun.ps1)
- on macOS and Linux, this runs the script: [`scripts/buildkite-link-bun.sh`](scripts/buildkite-link-bun.sh)

To speed up the build, thare are two options:

- `--fast`: This disables the LTO (link-time optimization) step.
- without `--fast`: This runs the LTO step, which is the default. The binaries that are release to Github are always built with LTO.

### Testing

### FAQ

> How do I add a new CI agent?

> How do I add/modify system dependencies?

> How do I SSH into a CI agent?

### Known issues

These are things that we know about, but haven't fixed or optimized yet.

- There is no `scripts/build-bun-zig.ps1` for Windows.

- The `build-deps` step does not cache in CI, so it re-builds each time (though it does use ccache). It attempts to check the `BUN_DEPS_CACHE_DIR` environment variable, but for some reason it doesn't work.

- Windows and Linux machines sometimes take up to 1-2 minutes to start tests. This is because robobun is listening for when the job is scheduled to provision the VM. Instead, it can start provisioning during the link step, or keep a pool of idle VMs around (but it's unclear how more expensive this is).

- There are a limited number of macOS VMs. This is because they are expensive and manually provisioned, mostly through MacStadium. If wait times are too long we can just provision more, or buy some.

- To prevent idle machines, robobun periodically checks for idle machines and terminates them. Before doing this, it checks to see if the machine is connected as an agent to Buildkite. However, sometimes the machine picks up a job in-between this time, and the job is terminated.
