#!/usr/bin/env bash
set -e

C_BOLD="\e[1;1m"
C_GREEN="\e[32m"
C_RED="\e[31m"
C_BLUE="\e[34m"
C_RESET="\e[0m"

has_exec() {
  which "$1" >/dev/null 2>&1 || return 1
}
fail() {
  has_failure=1
  printf "${C_RED}setup error${C_RESET}: %s\n" "$@"
}

if [[ $(uname -s) == 'Darwin' ]]; then
  export LLVM_VERSION=18

  # Use from brew --prefix if available
  if has_exec brew; then
    export PKG_CONFIG_PATH=$(brew --prefix)/lib/pkgconfig:$PKG_CONFIG_PATH

    # if llvm@18/bin/clang exists, use it
    if [ -x "$(brew --prefix)/opt/llvm@$LLVM_VERSION/bin/clang" ]; then
      export PATH=$(brew --prefix)/opt/llvm@$LLVM_VERSION/bin:$PATH
      export CC=$(brew --prefix)/opt/llvm@$LLVM_VERSION/bin/clang
      export CXX=$(brew --prefix)/opt/llvm@$LLVM_VERSION/bin/clang++
      export AR=$(brew --prefix)/opt/llvm@$LLVM_VERSION/bin/llvm-ar
    else
      export CC=$(which clang-$LLVM_VERSION || which clang || which cc)
      export CXX=$(which clang++-$LLVM_VERSION || which clang++ || which c++)
      export AR=$(which llvm-ar-$LLVM_VERSION || which llvm-ar || which ar)
    fi
  fi

  test -n "$CC" || fail "missing LLVM $LLVM_VERSION (could not find clang)"
  test -n "$CXX" || fail "missing LLVM $LLVM_VERSION (could not find clang++)"
else
  export LLVM_VERSION=16

  export CC=$(which clang-$LLVM_VERSION || which clang || which cc)
  export CXX=$(which clang++-$LLVM_VERSION || which clang++ || which c++)
  export AR=$(which llvm-ar-$LLVM_VERSION || which llvm-ar || which ar)
fi

test -n "$CC" || fail "missing LLVM $LLVM_VERSION (could not find clang)"
test -n "$CXX" || fail "missing LLVM $LLVM_VERSION (could not find clang++)"

for type in CC CXX; do
  compiler="${!type}"
  $(
    "$compiler" --version | grep "clang version ${LLVM_VERSION}." >/dev/null 2>&1
  ) || fail "LLVM ${LLVM_VERSION} is required. Detected $type as '$compiler'"
done

has_exec "bun" || fail "you need an existing copy of 'bun' in your path to build bun"
has_exec "cmake" || fail "'cmake' is missing"
has_exec "ninja" || fail "'ninja' is missing"
$(
  has_exec "rustc" &&
    (test $(cargo --version | awk '{print $2}' | cut -d. -f2) -gt 57) &&
    has_exec "cargo"
) || fail "Rust and Cargo version must be installed (minimum version 1.57)"
has_exec "go" || fail "'go' is missing"

has_exec "${PKG_CONFIG:-pkg-config}" || fail "'pkg-config' is missing"
has_exec "automake" || fail "'automake' is missing"
has_exec "perl" || fail "'perl' is missing"
has_exec "ruby" || fail "'ruby' is missing"

if [ -n "$has_failure" ]; then
  exit 1
fi

rm -f .vscode/clang++
ln -s "$CXX" .vscode/clang++

printf "All system dependencies OK\n"
printf "C Compiler for dependencies: ${CC}\n"
printf "C++ Compiler for dependencies: ${CXX}\n"

cd "$(dirname "${BASH_SOURCE[0]}")"

rm -rf env.local
echo "# Environment variables as of last setup.sh run at $(date)" >env.local
echo "export CC=\"${CC}\"" >>env.local
echo "export CXX\"=${CXX}\"" >>env.local
echo "export AR=\"${AR}\"" >>env.local
echo "export PATH=\"${PATH}\"" >>env.local
echo "Saved environment variables to $(pwd)/env.local"

bash ./update-submodules.sh
bash ./all-dependencies.sh

cd ../

# Install bun dependencies
bun i
# Install test dependencies
cd test
bun i
cd ..

# TODO(@paperdave): do not use the Makefile please
has_exec "make" || fail "'make' is missing"
make runtime_js fallback_decoder bun_error node-fallbacks

mkdir -p build
rm -f build/CMakeCache.txt
cmake -B build -S . \
  -G Ninja \
  -DUSE_DEBUG_JSC=ON \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_C_COMPILER="$CC" \
  -DCMAKE_CXX_COMPILER="$CXX" \
  -UZIG_COMPILER "$*"

ninja -C build

printf "Checking if built bun functions\n"
BUN_VERSION=$(BUN_DEBUG_QUIET_LOGS=1 ./build/bun-debug --version)

printf "\n"
printf "🎉 ${C_GREEN}${C_BOLD}Development environment setup complete!${C_RESET}\n"
printf "${C_BLUE}bun v${BUN_VERSION} is located at ./build/bun-debug${C_RESET}\n"

if has_exec bun-debug; then
  bun_is_at=$(which bun-debug)
  if [ "$(realpath "$bun_is_at")" != "$(realpath "./build/bun-debug")" ]; then
    printf "\n"
    printf "${C_RED}"'Your $PATH is not configured correctly!\n'"${C_RESET}"
    printf "\n"
    printf "which bun-debug --> %s\n" "${bun_is_at}"
    printf "\n"
    printf "You should remove this binary and switch it to ./build:\n"
    printf '  export PATH="$PATH:%s"\n' $(realpath "$PWD/build")
  fi
else
  printf "\n"
  printf "You should add ./build to your path:\n"
  printf '  export PATH="$PATH:%s"\n' $(realpath "$PWD/build")
fi
printf "\n"
printf "To rebuild bun, run '${C_GREEN}bun run build${C_RESET}'\n\n"
