# Bun's Dev Container

To get started, login to GitHub and clone bun's GitHub repo into `/build/bun`

# First time setup

```bash
gh auth login # if it fails to open a browser, use Personal Access Token instead
gh repo clone oven-sh/bun . -- --depth=1 --progress -j8
```

# Compile bun dependencies (zig is already compiled)

```bash
make devcontainer
```

# Build bun for development

```bash
make dev
```

# Run bun

```bash
bun-debug help
```
