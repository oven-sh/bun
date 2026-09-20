dir=$(mktemp -d)
download "$BUN_NINJA_URL" "$dir/ninja.zip"
echo "$BUN_NINJA_SHA256  $dir/ninja.zip" | shasum -a 256 -c -
# Its own directory, not one on PATH: `ninja` there is Homebrew's, and that is the one the build runs.
sudo mkdir -p "$BUN_NINJA_DIR"
sudo unzip -q "$dir/ninja.zip" ninja -d "$BUN_NINJA_DIR"
rm -rf "$dir"
