## Developing bun

Estimated: 30-90 minutes :(

### VSCode Dev Container (Linux)

The VSCode Dev Container in this repository is the easiest way to get started. It comes with Zig, JavaScriptCore, Zig Language Server, vscode-zig, and more pre-installed on an instance of Ubuntu.

<img src="https://user-images.githubusercontent.com/709451/147319227-6446589c-a4d9-480d-bd5b-43037a9e56fd.png" />

To get started, install the devcontainer cli:

```bash
npm install -g @vscode/dev-container-cli
```

Then, in the `bun` repository locally run:

```bash
devcontainer build
devcontainer open
```

You will need to clone the GitHub repository inside that container, which also requires authenticating with GitHub (until bun's repository is public). Make sure to login with a Personal Access Token rather than a web browser.

Inside the container, run this:

```bash
# First time setup
gh auth login
gh repo clone Jarred-Sumner/bun . -- --depth=1 --progress -j8

# update all submodules except webkit because webkit takes awhile and it's already compiled for you.
git -c submodule."src/bun.js/WebKit".update=none submodule update --init --recursive --depth=1 --progress

# Compile bun dependencies (zig is already compiled)
make devcontainer

# Build bun for development
make dev

# Run bun
bun-debug
```

It is very similar to my own development environment.

### MacOS

Install LLVM 13 and homebrew dependencies:

```bash
brew install llvm@13 coreutils libtool cmake libiconv automake openssl@1.1 ninja gnu-sed pkg-config esbuild go
```

bun (& the version of Zig) need LLVM 13 and Clang 13 (clang is part of LLVM). Weird build & runtime errors will happen otherwise.

Make sure LLVM 13 is in your `$PATH`:

```bash
which clang-13
```

If it is not, you will have to run this to link it:

```bash
export PATH=$(brew --prefix llvm@13)/bin:$PATH
export LDFLAGS="$LDFLAGS -L$(brew --prefix llvm@13)/lib"
export CPPFLAGS="$CPPFLAGS -I$(brew --prefix llvm@13)/include"
```

On fish that looks like `fish_add_path (brew --prefix llvm@13)/bin`

You’ll want to make sure `zig` is in `$PATH`. The specific version of Zig expected is the HEAD in [Jarred-Sumner/zig](https://github.com/Jarred-Sumner/zig).

#### Build bun (macOS)

If you’re building on an Apple Silicon device, you’ll need to do is ensure you have set an environment variable `CODESIGN_IDENTITY`. You can find the correct value by visiting `Keychain Access` and looking under your `login` profile for `Certificates`. The name would usually look like `Apple Development: user@example.com (WDYABC123)`

If you’re not familiar with the process, there’s a guide [here](https://ioscodesigning.com/generating-code-signing-files/#generate-a-code-signing-certificate-using-xcode)

In `bun`:

```bash
# If you omit --depth=1, `git submodule update` will take 17.5 minutes on 1gbps internet, mostly due to WebKit.
git submodule update --init --recursive --progress --depth=1
make vendor jsc identifier-cache dev
```

#### Verify it worked (macOS)

First ensure the node dependencies are installed

```bash
cd test/snippets
npm i
```

Then

```bash
# if you’re not already in the bun root directory
cd ../../
make test-dev-all
```

#### Troubleshooting (macOS)

If you see an error when compiling `libarchive`, run this:

```bash
brew install pkg-config
```

If you see an error about missing files on `zig build obj`, make sure you built the headers

## vscode-zig

Note: this is automatically installed on the devcontainer

You will want to install the fork of `vscode-zig` so you get a `Run test` and a `Debug test` button.

To do that:

```bash
curl -L https://github.com/Jarred-Sumner/vscode-zig/releases/download/fork-v1/zig-0.2.5.vsix > vscode-zig.vsix
code --install-extension vscode-zig.vsix
```

<a target="_blank" href="https://github.com/jarred-sumner/vscode-zig"><img src="https://pbs.twimg.com/media/FBZsKHlUcAYDzm5?format=jpg&name=large"></a>
