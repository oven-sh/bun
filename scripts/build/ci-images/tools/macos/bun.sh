dir=$(mktemp -d)
download "$BUN_URL" "$dir/bun.zip"
unzip -q "$dir/bun.zip" -d "$dir"
sudo mkdir -p /usr/local/bin
sudo install -m 755 "$dir/$BUN_TRIPLET/bun" /usr/local/bin/bun
sudo ln -sf bun /usr/local/bin/bunx
rm -rf "$dir"
