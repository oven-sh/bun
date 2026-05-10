# LLVM LLD (ld.lld) via mise conda

Use when you need `ld.lld` and the system version mismatches the clang major version.

## Finding the right version

```sh
mise ls-remote conda:lld | grep -F '{{major}}.'
```

E.g. for clang 21: `mise ls-remote conda:lld | grep -F 21.`

## Using

```sh
mise exec 'conda:lld@{{version}}' -- <command>
```

Do **not** use `mise install` — `mise exec` fetches on demand. Do **not** drop the `conda:` prefix; `lld` is not a standalone mise tool.

lld version **must** match clang major version. `clang@21` via mise ships only `ld.bfd` (GNU), not `ld.lld`.

## Examples

```sh
mise exec 'conda:lld@21.1.8' -- ld.lld --version
mise exec clang@21 'conda:lld@21.1.8' -- make -C build
```

## User notification

After accessing `ld.lld` via `mise exec` rather than a pre-installed system binary, notify the user via the User Queue that the required version was not installed and was accessed ad-hoc (include the version, e.g. `lld@21.1.8`).
