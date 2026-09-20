dpkg --add-architecture amd64
apt-get update --yes
apt-get install --yes --no-install-recommends "libclang-rt-$LLVM_MAJOR-dev:amd64"
