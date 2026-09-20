dir=$(mktemp -d)
download "$BUN_NINJA_URL" "$dir/ninja.zip"
echo "$BUN_NINJA_SHA256  $dir/ninja.zip" | sha256sum -c -
# Its own directory, not one on PATH: `ninja` there is the machine's own, and that is the one the build runs.
mkdir -p "$BUN_NINJA_DIR"
unzip -q "$dir/ninja.zip" ninja -d "$BUN_NINJA_DIR"
rm -rf "$dir"
