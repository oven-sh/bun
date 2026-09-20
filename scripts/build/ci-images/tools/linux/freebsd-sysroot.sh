dir=$(mktemp -d)
for pair in "$FREEBSD_AMD64_URL $FREEBSD_SYSROOT_X64" "$FREEBSD_ARM64_URL $FREEBSD_SYSROOT_AARCH64"; do
  url=${pair% *}
  sysroot=${pair#* }
  download "$url" "$dir/base.txz"
  mkdir -p "$sysroot"
  tar -C "$sysroot" -xJf "$dir/base.txz" ./usr/include ./usr/lib ./lib
done
rm -rf "$dir"
