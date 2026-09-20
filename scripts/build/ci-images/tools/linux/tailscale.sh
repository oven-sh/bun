dir=$(mktemp -d)
download "$TAILSCALE_INSTALL_URL" "$dir/install.sh"
sh "$dir/install.sh"
rm -rf "$dir"
