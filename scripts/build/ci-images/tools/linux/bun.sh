dir=$(mktemp -d)
download "$BUN_URL" "$dir/bun.zip"
unzip -q "$dir/bun.zip" -d "$dir"
install -m 755 "$dir/$BUN_TRIPLET/bun" /usr/local/bin/bun
ln -sf bun /usr/local/bin/bunx
rm -rf "$dir"

installed=$(bun --version)
[ "$installed" = "$BUN_VERSION" ] || fail "bun --version is $installed, expected $BUN_VERSION"
