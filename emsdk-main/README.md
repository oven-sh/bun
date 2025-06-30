Emscripten SDK
==============

[![CircleCI](https://circleci.com/gh/emscripten-core/emsdk/tree/main.svg?style=svg)](https://circleci.com/gh/emscripten-core/emsdk/tree/main)

The Emscripten toolchain is distributed as a standalone Emscripten SDK. The SDK
provides all the required tools, such as Clang, Python and Node.js along with an
update mechanism that enables migrating to newer Emscripten versions as they are
released.

You can also set up Emscripten from source, without the pre-built SDK, see
"Installing from Source" below.

## Downloads / How do I get the latest Emscripten build?

To get started with Emscripten development, see the [Emscripten website
documentation](https://emscripten.org/docs/getting_started/downloads.html).

That explains how to use the emsdk to get the latest binary builds (without
compiling from source). Basically, that amounts to

```
git pull
./emsdk install latest
./emsdk activate latest
```

## SDK Concepts

The Emscripten SDK is effectively a small package manager for tools that are
used in conjunction with Emscripten. The following glossary highlights the
important concepts to help understanding the internals of the SDK:

* **Tool**: The basic unit of software bundled in the SDK. A Tool has a name and
  a version. For example, 'clang-3.2-32bit' is a Tool that contains the 32-bit
  version of the Clang v3.2 compiler.
* **SDK**: A set of tools. For example, 'sdk-1.5.6-32bit' is an SDK consisting
  of the tools `clang-3.2-32bit`, `node-0.10.17-32bit`, `python-2.7.5.1-32bit`
  and `emscripten-1.5.6`.
* **Active Tool/SDK**: Emscripten SDK stores compiler configuration in a file
  called `.emscripten` within the emsdk directory. This file points to paths
  for Emscripten, Python, Clang and so on. If the configuration file points to a
  Tool in a specific directory, then that tool is denoted as being
  **active**. This mechanism allows switching between different installed
  tools and SDKs.
* **emsdk**: This is the name of the manager script that Emscripten SDK is
  accessed through. Most operations are of the form `emsdk <command>`.

## System Requirements

Using the emsdk pre-compiled packages requires only the minimal set of
dependencies lists below.  When building from source a wider set of tools
include git, cmake, and a host compiler are required. See:
https://emscripten.org/docs/building_from_source/toolchain_what_is_needed.html.

### Mac OS X

- For Intel-based Macs, macOS 10.13 or newer. For ARM64 M1 based Macs, macOS
  11.0 or newer.
- `java`: For running closure compiler (optional).  After installing emscripten
  via emsdk, typing 'emcc --help' should pop up a OS X dialog "Java is not
  installed. To open java, you need a Java SE 6 runtime. Would you like to
  install one now?" that will automatically download a Java runtime to the
  system.

### Linux

- `python`: Version 3.8 or above.
- `java`: For running closure compiler (optional)

The emsdk pre-compiled binaries are built against Ubuntu/Focal 20.04 LTS and
therefore depend on system libraries compatible with versions of `glibc` and
`libstdc++` present in that release.  If your linux distribution is very old
you may not be able to use the pre-compiled binaries packages.

### Windows

- `java`: For running closure compiler (optional)

## Uninstalling the Emscripten SDK

To remove the Emscripten SDK, simply delete the emsdk directory.

## SDK Maintenance

The following tasks are common with the Emscripten SDK:

### How do I work the emsdk utility?

Run `emsdk help` or just `emsdk` to get information about all available commands.

### How do I check the installation status and version of the SDK and tools?

To get a list of all currently installed tools and SDK versions, and all
available tools, run `emsdk list`.
* A line will be printed for each tool/SDK that is available for installation.
* The text `INSTALLED` will be shown for each tool that has already been
  installed.
* If a tool/SDK is currently active, a star * will be shown next to it.
* If a tool/SDK is currently active, but the terminal your are calling emsdk
  from does not have `PATH` and environment set up to utilize that tool, a star
  in parentheses (\*) will be shown next to it. Run `emsdk_env.bat` (Windows) or
  `source ./emsdk_env.sh` (Linux and OS X) to set up the environment for the
  calling terminal.

### How do I install a tool/SDK version?

Run the command `emsdk install <tool/sdk name>` to download and install a new
tool or an SDK version.

### How do I remove a tool or an SDK?

Run the command `emsdk uninstall <tool/sdk name>` to delete the given tool or
SDK from the local hard drive completely.

### How do I check for updates to the Emscripten SDK?

`emsdk update` will fetch package information for all the new tools and
SDK versions. After that, run `emsdk install <tool/sdk name>` to install a new
version.

### How do I install an old Emscripten compiler version?

Emsdk contains a history of old compiler versions that you can use to maintain
your migration path. Type `emsdk list --old` to get a list of archived tool and
SDK versions, and `emsdk install <name_of_tool>` to install it.

### I want to build from source!

Some Emsdk Tool and SDK targets refer to packages that are precompiled, and
no compilation is needed when installing them. Other Emsdk Tools and SDK
targets come "from source", meaning that they will fetch the source repositories
using git, and compile the package on demand.

When you run `emsdk list`, it will group the Tools and SDKs under these two
categories.

To obtain and build latest wasm SDK from source, run

```
emsdk install sdk-main-64bit
emsdk activate sdk-main-64bit
```

You can use this target for example to bootstrap developing patches to LLVM,
Binaryen or Emscripten. (After initial installation, use `git remote add`
in the cloned tree to add your own fork to push changes as patches)

If you only intend to contribute to Emscripten repository, and not to LLVM
or Binaryen, you can also use precompiled versions of them, and only git
clone the Emscripten repository. For more details, see

https://emscripten.org/docs/contributing/developers_guide.html?highlight=developer#setting-up

### When working on git branches compiled from source, how do I update to a newer compiler version?

Unlike tags and precompiled versions, a few of the SDK packages are based on
"moving" git branches and compiled from source (e.g. sdk-main,
sdk-main, emscripten-main, binaryen-main). Because of that, the
compiled versions will eventually go out of date as new commits are introduced
to the development branches. To update an old compiled installation of one of
this branches, simply reissue the "emsdk install" command on that tool/SDK. This
will `git pull` the latest changes to the branch and issue an incremental
recompilation of the target in question. This way you can keep calling `emsdk
install` to keep an Emscripten installation up to date with a given git branch.

Note though that if the previously compiled branch is very old, sometimes CMake
gets confused and is unable to properly rebuild a project. This has happened in
the past e.g. when LLVM migrated to requiring a newer CMake version. In cases of
any odd compilation errors, it is advised to try deleting the intermediate build
directory to clear the build (e.g. "emsdk/clang/fastcomp/build_xxx/") before
reissuing `emsdk install`.

### How do I change the currently active SDK version?

You can toggle between different tools and SDK versions by running `emsdk
activate <tool/sdk name>`. Activating a tool will set up `~/.emscripten` to
point to that particular tool. On Windows, you can pass the option `--permanent` to
the `activate` command to register the environment permanently for the current user. Use `--system` to do this for all users.

### How do I track the latest Emscripten development with the SDK?

A common and supported use case of the Emscripten SDK is to enable the workflow
where you directly interact with the github repositories. This allows you to
obtain new features and latest fixes immediately as they are pushed to the
github repository, without having to wait for release to be tagged. You do not
need a github account or a fork of Emscripten to do this. To switch to using the
latest git development branch `main`, run the following:

    emsdk install git-1.9.4 # Install git. Skip if the system already has it.
    emsdk install sdk-main-64bit # Clone+pull the latest emscripten-core/emscripten/main.
    emsdk activate sdk-main-64bit # Set the main SDK as the currently active one.

### How do I use my own Emscripten github fork with the SDK?

It is also possible to use your own fork of the Emscripten repository via the
SDK. This is achieved with standard git machinery, so if you are already
acquainted with working on multiple remotes in a git clone, these steps should
be familiar to you. This is useful in the case when you want to make your own
modifications to the Emscripten toolchain, but still keep using the SDK
environment and tools. To set up your own fork as the currently active
Emscripten toolchain, first install the `sdk-main` SDK like shown in the
previous section, and then run the following commands in the emsdk directory:

    cd emscripten/main
    # Add a git remote link to your own repository.
    git remote add myremote https://github.com/mygituseraccount/emscripten.git
    # Obtain the changes in your link.
    git fetch myremote
    # Switch the emscripten-main tool to use your fork.
    git checkout -b mymain --track myremote/main

In this way you can utilize the Emscripten SDK tools while using your own git
fork. You can switch back and forth between remotes via the `git checkout`
command as usual.

### How do I use Emscripten SDK with a custom version of python, java, node.js or some other tool?

The provided Emscripten SDK targets are metapackages that refer to a specific
set of tools that have been tested to work together. For example,
`sdk-1.35.0-64bit` is an alias to the individual packages `clang-e1.35.0-64bit`,
`node-4.1.1-64bit`, `python-2.7.5.3-64bit` and `emscripten-1.35.0`. This means
that if you install this version of the SDK, both python and node.js will be
installed inside emsdk as well. If you want to use your own/system python or
node.js instead, you can opt to install emsdk by specifying the individual set
of packages that you want to use. For example, `emsdk install
clang-e1.35.0-64bit emscripten-1.35.0` will only install the Emscripten
LLVM/Clang compiler and the Emscripten frontend without supplying python and
node.js.

### My installation fails with "fatal error: ld terminated with signal 9 [Killed]"?

This may happen if the system runs out of memory. If you are attempting to build
one of the packages from source and are running in a virtual OS or may have
relatively little RAM and disk space available, then the build might fail. Try
feeding your computer more memory. Another thing to try is to force emsdk
install to build in a singlethreaded mode, which will require less RAM
simultaneously. To do this, pass the `-j1` flag to the `emsdk install` command.

### How do I run Emscripten on 32-bit systems or non-x86-64 systems?

Emscripten SDK releases are no longer packaged or maintained for 32-bit systems.
If you want to run Emscripten on a 32-bit system, you can try manually building
the compiler. Follow the steps in the above section "Building an Emscripten tag
or branch from source" to get started.
