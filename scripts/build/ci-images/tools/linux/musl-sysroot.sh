# apk.static installs packages of any architecture into any root.
dir=$(mktemp -d)
download "$ALPINE_REPOSITORY/$ALPINE_HOST_ARCH/APKINDEX.tar.gz" "$dir/APKINDEX.tar.gz"
version=$(tar -xzOf "$dir/APKINDEX.tar.gz" APKINDEX | awk '/^P:apk-tools-static$/{f=1} f&&/^V:/{print substr($0,3); exit}')
[ -n "$version" ] || fail "the Alpine index has no apk-tools-static"
download "$ALPINE_REPOSITORY/$ALPINE_HOST_ARCH/apk-tools-static-$version.apk" "$dir/apk-tools-static.apk"
tar -xzf "$dir/apk-tools-static.apk" -C "$dir" sbin/apk.static

for pair in "x86_64 $MUSL_SYSROOT_X64" "aarch64 $MUSL_SYSROOT_AARCH64"; do
  arch=${pair% *}
  sysroot=${pair#* }
  mkdir -p "$sysroot"
  "$dir/sbin/apk.static" --arch "$arch" --root "$sysroot" --repository "$ALPINE_REPOSITORY" \
    --allow-untrusted --no-cache --initdb add musl-dev libc-dev linux-headers g++ libstdc++-dev
done
rm -rf "$dir"
