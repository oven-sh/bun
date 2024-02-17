This document describes the build process for Windows. If you run into problems, please join the [#windows channel on our Discord](http://bun.sh/discord) for help.

It is strongly recommended to use [PowerShell 7 (`pwsh.exe`)](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows?view=powershell-7.4) instead of the default `powershell.exe`.

## Prerequisites

<!--
{% details summary="Extra notes for Bun Core Team Members" %}

Here are the extra steps I ran on my fresh windows machine (some of these are a little opiniated)

- Change user to a local account (set username to `window` and 'bun!')
- Set Windows Terminal as default terminal
- Install latest version of Powershell
- Display scale to 100%
- Remove McAfee and enable Windows Defender (default antivirus, does not nag you)
- Install Software
  - OpenSSH server (run these in an elevated terminal)
    - `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`
    - `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`
    - `Start-Service sshd`
    - `Set-Service -Name sshd -StartupType 'Automatic'`
    - `New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Program Files\PowerShell\7\pwsh.exe" -PropertyType String -Force`
    - Configure in `C:\ProgramData\ssh`
    - Add ssh keys (in ProgramData because it is an admin account)
  - Tailscale (login with GitHub so it joins the team tailnet)
  - Visual Studio Code
- Configure `git`
  - `git config user.name "your name"`
  - `git config user.email "your@email"`
- Disable sleep mode and the lid switch by going to "Power Options" and configuring everything there.

I recommend using VSCode through SSH instead of Tunnels or the Tailscale extension, it seems to be more reliable.

{% /details %} -->

### Enable Scripts

By default, running unverified scripts are blocked.

```ps1
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Unrestricted
```

### System Dependencies

- Bun 1.1 or later. We use Bun to run it's own code generators.

```ps1
irm bun.sh/install.ps1 | iex
```

- [Visual Studio](https://visualstudio.microsoft.com) with the "Desktop Development with C++" workload.
  - Install Git and CMake from this installer, if not already installed.

After Visual Studio, you need the following:

- LLVM 16
- Go
- Rust
- NASM
- Perl
- Ruby
- Node.js

{% callout %}
The Zig compiler is automatically downloaded, installed, and updated by the building process.
{% /callout %}

[Scoop](https://scoop.sh) can be used to install these remaining tools easily:

```ps1
irm https://get.scoop.sh | iex

scoop install nodejs-lts go rust nasm ruby perl
scoop llvm@16.0.4 # scoop bug if you install llvm and the rest at the same time
```

If you intend on building WebKit locally (optional), you should install these packages:

```ps1
scoop install make cygwin python
```

From here on out, it is **expected you use a PowerShell Terminal with `.\scripts\env.ps1` sourced**. This script is available in the Bun repository and can be loaded by executing it:

```ps1
.\scripts\env.ps1
```

To verify, you can check for an MSVC-only command line such as `mt.exe`

```ps1
Get-Command mt
```

{% callout %}
It is not recommended to install `ninja` / `cmake` into your global path, because you may run into a situation where you try to build bun without .\scripts\env.ps1 sourced.
{% /callout %}

## Building

```ps1
bun install

.\scripts\env.ps1
.\scripts\update-submodules.ps1 # this syncs git submodule state
.\scripts\all-dependencies.ps1 # this builds all dependencies
.\scripts\make-old-js.ps1 # runs some old code generators

# Configure build environment
cmake -Bbuild -GNinja -DCMAKE_BUILD_TYPE=Debug

# Build bun
ninja -Cbuild
```

If this was successful, you should have a `bun-debug.exe` in the `build` folder.

```ps1
.\build\bun-debug.exe --revision
```

You should add this to `$Env:PATH`. The simplest way to do so is to open the start menu, type "Path", and then navigate the environment variables menu to add `C:\.....\bun\build` to the user environment variable `PATH`. You should then restart your editor (if it does not update still, log out and log back in).

## Extra paths

- WebKit is extracted to `build/bun-webkit`
- Zig is extracted to `.cache/zig/zig.exe`

## Tests

You can run the test suite either using `bun test`, or by using the wrapper script `packages\bun-internal-test`. The internal test package is a wrapper cli to run every test file in a separate instance of bun.exe, to prevent a crash in the test runner from stopping the entire suite.

```ps1
# Setup
bun i --cwd packages\bun-internal-test

# Run the entire test suite with reporter
# the package.json script "test" uses "build/bun-debug.exe" by default
bun run test

# Run an individual test file:
bun-debug test node\fs
bun-debug test "C:\bun\test\js\bun\resolve\import-meta.test.js"
```

## Troubleshooting

### .rc file fails to build

`llvm-rc.exe` is odd. don't use it. use `rc.exe`, to do this make sure you are in a visual studio dev terminal, check `rc /?` to ensure it is `Microsoft Resource Compiler`

### failed to write output 'bun-debug.exe': permission denied

you cannot overwrite `bun-debug.exe` if it is already open. you likely have a running instance, maybe in the vscode debugger?
