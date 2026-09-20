# binutils-x86-64-linux-gnu: a strip that accepts x86-64 objects on the arm64 host.
apt-get install --yes --no-install-recommends skopeo jq binutils-x86-64-linux-gnu

for arch in amd64 arm64; do
  case "$arch" in
    amd64) sysroot=/opt/linux-sysroot-glibc triple=x86_64-linux-gnu mirror=http://archive.ubuntu.com/ubuntu debs=$GCC_DEBS_AMD64_URL ;;
    arm64) sysroot=/opt/linux-sysroot-glibc-arm64 triple=aarch64-linux-gnu mirror=http://ports.ubuntu.com/ubuntu-ports debs=$GCC_DEBS_ARM64_URL ;;
  esac
  dir=$(mktemp -d)
  mkdir -p "$sysroot" "$dir/image" "$dir/gcc"

  # 1. The ubuntu:20.04 root filesystem. Device nodes cannot be created here
  #    and are not needed, so tar's complaints about them are dropped.
  skopeo copy --override-arch "$arch" docker://docker.io/library/ubuntu:20.04 "dir:$dir/image"
  for layer in $(jq -r '.layers[].digest' "$dir/image/manifest.json" | sed 's/^sha256://'); do
    tar -xzf "$dir/image/$layer" -C "$sysroot" 2>/dev/null || true
  done

  # 2. libc's runtime and headers from focal; focal-updates first, so its
  #    version of a package is the one found.
  download "$mirror/dists/focal-updates/main/binary-$arch/Packages.gz" "$dir/updates.gz"
  download "$mirror/dists/focal/main/binary-$arch/Packages.gz" "$dir/release.gz"
  gzip -dc "$dir/updates.gz" "$dir/release.gz" > "$dir/Packages"
  for package in libc6 libc6-dev linux-libc-dev libcrypt1 libcrypt-dev; do
    path=$(awk -v p="$package" '$1=="Package:"&&$2==p{f=1} f&&$1=="Filename:"{print $2; exit}' "$dir/Packages")
    [ -n "$path" ] || fail "focal has no $package for $arch"
    download "$mirror/$path" "$dir/package.deb"
    dpkg-deb -x "$dir/package.deb" "$sysroot"
  done
  # Absolute symlinks point at the host; keep them inside the sysroot.
  find "$sysroot" -type l | while read -r link; do
    target=$(readlink "$link")
    case "$target" in /*) ln -sfn "$sysroot$target" "$link" ;; esac
  done
  # libc.so is a linker script naming /lib/<triple>/.
  [ -e "$sysroot/lib/$triple/libc.so.6" ] || { mkdir -p "$sysroot/lib" && ln -sfn "../usr/lib/$triple" "$sysroot/lib/$triple"; }
  [ "$arch" != amd64 ] || [ -e "$sysroot/lib64" ] || ln -sfn "usr/lib/$triple" "$sysroot/lib64"

  # 3. gcc-13's libstdc++ and libgcc, the same packages WebKit's image uses.
  download "$debs" "$dir/gcc.tar.gz"
  tar -xzf "$dir/gcc.tar.gz" -C "$dir/gcc"
  for deb in "$dir/gcc"/*.deb; do
    dpkg-deb -x "$deb" "$sysroot"
  done
  rm -rf "$dir"

done
