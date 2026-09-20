dir=$(mktemp -d)
for pair in "$FREEBSD_AMD64_URL /opt/freebsd-sysroot" "$FREEBSD_ARM64_URL /opt/freebsd-sysroot-arm64"; do
  url=${pair% *}
  sysroot=${pair#* }
  download "$url" "$dir/base.txz"
  mkdir -p "$sysroot"
  tar -C "$sysroot" -xJf "$dir/base.txz" ./usr/include ./usr/lib ./lib
  [ -f "$sysroot/usr/include/sys/param.h" ] && [ -f "$sysroot/lib/libc.so.7" ] || fail "$sysroot is incomplete"
done
rm -rf "$dir"
