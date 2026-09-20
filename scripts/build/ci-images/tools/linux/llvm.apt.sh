# apt.llvm.org signs with a SHA-1 key, which apt's sqv verifier stopped
# accepting on 2026-02-01: https://github.com/llvm/llvm-project/issues/153385
if [ -x /usr/bin/sqv ] && [ -f /usr/share/apt/default-sequoia.config ]; then
  mkdir -p /etc/crypto-policies/back-ends
  sed 's/sha1.second_preimage_resistance = 2026-02-01/sha1.second_preimage_resistance = 2028-02-01/' \
    /usr/share/apt/default-sequoia.config > /etc/crypto-policies/back-ends/apt-sequoia.config
fi

dir=$(mktemp -d)
download "$LLVM_SH_URL" "$dir/llvm.sh"
bash "$dir/llvm.sh" "$LLVM_MAJOR" all
rm -rf "$dir"
# llvm-symbolizer, for ASAN reports.
apt-get install --yes --no-install-recommends "llvm-$LLVM_MAJOR-tools"
# Debian only links some of the tools into /usr/bin without a version suffix.
add_to_path "/usr/lib/llvm-$LLVM_MAJOR/bin"

clang --version | head -n1 | grep -q "version $LLVM_MAJOR_MINOR\." || fail "clang --version is not $LLVM_MAJOR_MINOR.x"
