## Prerequisites

### System Dependencies

- [Visual Studio](https://visualstudio.microsoft.com) with the "Desktop Development with C++" workload. You should install Git and CMake from here, if not already installed.
- Ninja
- Go
- Rust
- NASM
- Perl
- Ruby
- Node.js (until bun runs stably on windows)

<!--
TODO: missing the rest of the things
```
winget install OpenJS.NodeJS.LTS
``` -->

### Enable Scripts

By default, scripts are blocked.

```ps1
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted
```

### Zig

Bun pins a version of Zig. As the compiler is still in development, breaking changes happen often that will break the build. It is recommended to use [Zigup](https://github.com/marler8997/zigup/releases) as it can quickly switch to any version by name, but you can also [manually download Zig](https://ziglang.org/download/).

```bash
$ zigup 0.12.0-dev.1604+caae40c21
```

{% callout %}
We last updated Zig on **October 26th, 2023**
{% /callout %}

### Codegen

On Unix platforms, we depend on an existing build of Bun to generate code for itself. Since the Windows branch is not stable enough for this to pass, you currently need to generate the code.

On a system with Bun installed, run:

```bash
$ bash ./scripts/cross-compile-codegen.sh win32 x64
# -> build-codegen-win32-x64
```

Copy the contents of this to the Windows machine into a folder named `build`

TODO: Use WSL to automatically run codegen without a separate machine.

## Building

```ps1
npm install

.\scripts\env.ps1

.\scripts\update-submodules.ps1
.\scripts\all-dependencies.ps1

cd build # this was created by the codegen script in the prerequisites

cmake .. -G Ninja -DCMAKE_BUILD_TYPE=Debug
ninja
```

If this was successful, you should have a `bun-debug.exe` in the `build` folder.

```ps1
.\bun-debug.exe --version
```
