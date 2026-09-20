sysroot=/opt/winsysroot
dir=$(mktemp -d)
download "$XWIN_URL" "$dir/xwin.tar.gz"
tar -xzf "$dir/xwin.tar.gz" -C "$dir" --strip-components=1
mkdir -p "$sysroot"
"$dir/xwin" --accept-license --arch x86_64,aarch64 \
  --sdk-version "$WINDOWS_SDK_VERSION" --crt-version "$MSVC_CRT_VERSION" --include-atl --cache-dir "$dir/cache" \
  splat --use-winsysroot-style --preserve-ms-arch-notation --include-debug-libs --output "$sysroot" > /dev/null
rm -rf "$dir"
# clang-cl asks for Include and Lib; xwin writes them in lower case.
ln -s include "$sysroot/Windows Kits/10/Include"
ln -s lib "$sysroot/Windows Kits/10/Lib"

ls "$sysroot/Windows Kits/10/lib/"*/um/x64/kernel32.[Ll]ib > /dev/null || fail "$sysroot has no kernel32.lib"
ls "$sysroot"/VC/Tools/MSVC/*/include/atlstr.h > /dev/null || fail "$sysroot has no ATL headers"
