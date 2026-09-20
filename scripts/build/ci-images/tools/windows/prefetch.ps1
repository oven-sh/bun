# The bake machine has no checkout: it is a VM Packer drives from outside. It
# clones the one commit being built.
$repo = "$env:TEMP\bun"
Run git init --quiet $repo
Run git -C $repo fetch --quiet --depth=1 https://github.com/oven-sh/bun.git $REPO_COMMIT
Run git -C $repo checkout --quiet FETCH_HEAD

New-Item -Path $PREFETCH_DIR -ItemType Directory -Force | Out-Null
Push-Location $repo
Run bun scripts\prefetch-deps.ts $PREFETCH_DIR
Pop-Location
Run attrib +R "$prefetch\*" /S /D
Set-Env BUN_BUILD_PREFETCH_DIR $prefetch

$cache = "C:\bun-install-cache"
New-Item -Path $cache -ItemType Directory -Force | Out-Null
$env:BUN_INSTALL_CACHE_DIR = $cache
foreach ($package in ".", "test", "scripts\ci-remap-server") {
  Push-Location "$repo\$package"
  Run bun install --ignore-scripts
  Pop-Location
}
Set-Env BUN_INSTALL_CACHE_DIR $cache

Run cmd /c rmdir /s /q $repo
