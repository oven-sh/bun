sysroot=$WINDOWS_SYSROOT
dir=$(mktemp -d)
download "$XWIN_URL" "$dir/xwin.tar.gz"
tar -xzf "$dir/xwin.tar.gz" -C "$dir" --strip-components=1
mkdir -p "$sysroot"
# splat moves what it unpacked with rename(2), which cannot cross filesystems,
# and /tmp is a tmpfs on the base image: the cache goes next to the output.
cache="$sysroot.cache"
"$dir/xwin" --accept-license --arch x86_64,aarch64 \
  --sdk-version "$WINDOWS_SDK_VERSION" --crt-version "$MSVC_CRT_VERSION" --include-atl --cache-dir "$cache" \
  splat --use-winsysroot-style --preserve-ms-arch-notation --include-debug-libs --output "$sysroot" > /dev/null
rm -rf "$dir" "$cache"
# clang-cl asks for Include and Lib; xwin writes them in lower case.
ln -s include "$sysroot/Windows Kits/10/Include"
ln -s lib "$sysroot/Windows Kits/10/Lib"
