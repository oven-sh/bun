#!/bin/sh
# Script to build Bun from source.
# Uses `sh` instead of `bash`, so it can run in minimal Docker images.

path() {
  string="$1"
  for arg in "${@:2}"; do
    if [ -n "$arg" ]; then
      string="$string/$arg"
    fi
  done
  if [ -n "$string" ] && [ "$os" = "windows" ]; then
    cygpath -w "$string" | sed 's/\\/\//g'
  else
    echo "$string"
  fi
}

scripts_dir=$(path $(cd -- "$(dirname -- "$0")" && pwd -P))
project_dir=$(path $(dirname "$scripts_dir"))
src_dir=$(path "$project_dir" "src")
src_deps_dir=$(path "$src_dir" "deps")
build_dir=$(path "$project_dir" "build")
build_deps_dir=$(path "$build_dir" "bun-deps")

which() {
  if [ "$os" = "windows" ] && command -v "$1" >/dev/null 2>&1; then
    # On Windows, cygwin will transform to path to /cygdrive which
    # causes problems with cmake and other tools.
    cygpath -w $(command -v "$1") | sed 's/\\/\//g'
  else
    command -v "$1"
  fi
}

exists() {
  which "$1" >/dev/null 2>&1
}

require() {
  if ! exists "$1"; then
    error "command is required to build bun: $1"
  fi
  which "$1"
}

is_interactive() {
  if exists tty && tty -s >/dev/null 2>&1; then
    print "1"
  fi
}

ansi_color() {
  case "$1" in
    reset)  printf "\033[0m" ;;
    bold)   printf "\033[1m" ;;
    dim)    printf "\033[2m" ;;
    red)    printf "\033[31m" ;;
    green)  printf "\033[32m" ;;
    yellow) printf "\033[33m" ;;
    pink)   printf "\033[35m" ;;
    cyan)   printf "\033[36m" ;;
    *) ;;
  esac
}

print() {
  printf "%s" "$1"
}

pretty() {
  string="$1"
  for color in reset bold dim red green yellow pink cyan; do
    string=$(print "$string" | sed -e "s/{$color}/$(ansi_color "$color")/g")
  done
  print "$string"
}

pretty_ln() {
  pretty "$1"
  printf "\n"
}

warn() {
  pretty_ln "{yellow}{bold}warn{reset}: $*{reset}" >&2
}

error() {
  pretty_ln "{red}{bold}error{reset}: $*{reset}" >&2
  exit 1
}

prompt() {
  if is_interactive >/dev/null; then
    pretty "$1 {dim}[y/n]{reset} "
    read -r
    case "$REPLY" in
      [yY]) ;;
      *) exit 1 ;;
    esac
  fi
}

lowercase() {
  tr '[:upper:]' '[:lower:]'
}

oneline() {
  head -n 1
}

regex() {
  # There are two versions of grep: GNU and BSD.
  # GNU grep supports -P, BSD grep supports -E.
  if grep --version | grep -q BSD 2>/dev/null; then
    grep -Eo "$1"
  else
    grep -Po "$1"
  fi
}

semver() {
  regex '[0-9]+\.[0-9]\.*[0-9]*' | oneline
}

machine_os() {
  os=$(uname -s)
  case "$os" in
    Linux)                    print "linux" ;;
    Darwin)                   print "darwin" ;;
    MINGW* | MSYS* | CYGWIN*) print "windows" ;;
    *) error "unsupported operating system: $os" ;;
  esac
}

machine_arch() {
  arch=$(uname -m)
  case "$arch" in
    x86_64 | amd64)  print "x64" ;;
    aarch64 | arm64) print "aarch64" ;;
    *) error "unsupported architecture: $arch" ;;
  esac
}

machine_cpu() {
  case "$arch" in
    x64)     print "haswell" ;;
    aarch64) print "native" ;;
    *) error "unsupported architecture: $arch" ;;
  esac
}

default_ci() {
  if [ "$CI" = "true" ] || [ "$CI" = "1" ]; then
    print "1"
  else
    print "0"
  fi
}

default_jobs() {
  if exists nproc; then
    nproc
  elif exists sysctl; then
    sysctl -n "hw.ncpu"
  else
    print "1"
  fi
}

default_llvm_version() {
  print "16"
}

default_macos_version() {
  print "12.0"
}

default_cc_version() {
  print "17"
}

default_cc_flags() {
  flags="$CFLAGS"

  if [ "$os" = "windows" ]; then
    flags="$flags /O2"
    flags="$flags /Z7"
    flags="$flags /MT"
    flags="$flags /Ob2"
    flags="$flags /DNDEBUG"
    flags="$flags /U_DLL"
  else
    flags="$flags -O3"
    flags="$flags -fno-exceptions"
    flags="$flags -fvisibility=hidden"
    flags="$flags -fvisibility-inlines-hidden"
    flags="$flags -mno-omit-leaf-frame-pointer"
    flags="$flags -fno-omit-frame-pointer"
    flags="$flags -fno-asynchronous-unwind-tables"
    flags="$flags -fno-unwind-tables"
    flags="$flags -faddrsig"
    flags="$flags -std=c$cc_version"
  fi

  if [ "$os" = "linux" ]; then
    flags="$flags -ffunction-sections"
    flags="$flags -fdata-sections"
  elif [ "$os" = "darwin" ]; then
    flags="$flags -mmacosx-version-min=$macos_version"
    flags="$flags -D__DARWIN_NON_CANCELABLE=1"
  fi

  if [ "$arch" = "aarch64" ]; then
    if [ "$os" = "linux" ]; then
      flags="$flags -march=armv8-a+crc"
      flags="$flags -mtune=ampere1"
    elif [ "$os" = "darwin" ]; then
      flags="$flags -mcpu=apple-m1"
    fi
  elif [ "$baseline" = "1" ]; then
    flags="$flags -march=nehalem"
  else
    flags="$flags -march=$cpu"
  fi

  flags="$flags -fuse-ld=$ld"
  if [ "$lto" = "1" ]; then
    flags="$flags -flto"
    if [ "$os" = "windows" ]; then
      flags="$flags -Xclang"
      flags="$flags -emit-llvm-bc"
    fi
  fi

  if [ "$os" != "windows" ]; then
    if [ -n "$FORCE_PIC" ]; then
      flags="$flags -fpic"
    else
      flags="$flags -fno-pie"
      flags="$flags -fno-pic"
    fi
  fi

  print "$flags"
}

default_cc() {
  if [ "$os" = "windows" ]; then
    which "clang-cl"
  else
    which "clang-$llvm_version" || which "clang" || which "cc"
  fi
}

default_cxx_version() {
  print "20"
}

default_cxx_flags() {
  flags="$CXXFLAGS"
  flags="$flags $(default_cc_flags)"
  flags="$flags -fno-rtti"
  flags="$flags -std=c++$cxx_version"
  print "$flags"
}

default_cxx() {
  if [ "$os" = "windows" ]; then
    which "clang-cl"
  else
    which "clang++-$llvm_version" || which "clang++" || which "c++"
  fi
}

default_cmake_flags() {
  flags="$CMAKE_FLAGS"
  flags="$flags -GNinja"
  flags="$flags -DCMAKE_BUILD_PARALLEL_LEVEL=$jobs"
  flags="$flags -DCMAKE_C_STANDARD=$cc_version"
  flags="$flags -DCMAKE_CXX_STANDARD=$cxx_version"
  flags="$flags -DCMAKE_C_STANDARD_REQUIRED=ON"
  flags="$flags -DCMAKE_CXX_STANDARD_REQUIRED=ON"
  flags="$flags -DCMAKE_C_COMPILER=$cc"
  flags="$flags -DCMAKE_CXX_COMPILER=$cxx"

  if [ "$type" = "debug" ]; then
    flags="$flags -DCMAKE_BUILD_TYPE=Debug"
  else
    flags="$flags -DCMAKE_BUILD_TYPE=Release"
  fi

  if [ -n "$ccache" ]; then
    flags="$flags -DCMAKE_C_COMPILER_LAUNCHER=$ccache"
    flags="$flags -DCMAKE_CXX_COMPILER_LAUNCHER=$ccache"
  fi

  if [ "$os" = "linux" ]; then
    flags="$flags -DCMAKE_CXX_EXTENSIONS=ON"
  elif [ "$os" = "darwin" ]; then
    flags="$flags -DCMAKE_OSX_DEPLOYMENT_TARGET=$macos_version"
  elif [ "$os" = "windows" ]; then
    flags="$flags -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded"
  fi

  if [ "$verbose" = "1" ]; then
    flags="$flags -DCMAKE_VERBOSE_MAKEFILE=ON"
  fi

  print "$flags"
}

default_ar() {
  which "llvm-ar-$llvm_version" || which "llvm-ar" || which "ar"
}

default_ld() {
  if [ "$os" = "darwin" ]; then
    which "ld64.lld" || which "ld"
  elif [ "$os" = "linux" ]; then
    which "ld.lld" || which "ld"
  elif [ "$os" = "windows" ]; then
    which "lld-link" || which "ld"
  fi
}

default_ccache() {
  which "ccache" || which "sccache"
}

default_zig_version() {
  path="$project_dir/build.zig"
  if [ -f "$path" ]; then
    grep 'recommended_zig_version = "' "$path" | cut -d '"' -f2
  else
    warn "--zig-version should be defined due to missing file: {dim}$path{reset}" >&2
    latest_zig_version
  fi
}

latest_zig_version() {
  curl -fsSL https://ziglang.org/download/index.json | jq -r .master.version
}

default_zig() {
  which zig
}

default_bun_version() {
  path="$project_dir/LATEST"
  if [ -f "$path" ]; then
    cat "$path"
  else
    warn "--bun-version should be defined due to missing file: {dim}$path{reset}" >&2
    latest_bun_version
  fi
}

latest_bun_version() {
  curl -fsSL https://raw.githubusercontent.com/oven-sh/bun/main/LATEST
}

default_bun() {
  which bun
}

default_version() {
  path="$project_dir/LATEST"
  if [ -f "$path" ]; then
    cat "$path"
  else
    warn "--version should be defined due to missing file: {dim}$path{reset}" >&2
    print "0.0.0"
  fi
}

default_revision() {
  if $(cd "$project_dir" && git rev-parse --is-inside-work-tree >/dev/null 2>&1); then
    revision=$(cd "$project_dir" && git rev-parse HEAD)
    print "$revision"
  else
    warn "--revision should be defined due missing git repository" >&2
    print "unknown"
  fi
}

artifact="bun"
jobs=$(default_jobs)
clean="0"
ci=$(default_ci)
verbose="0"

os=$(machine_os)
arch=$(machine_arch)
cpu=$(machine_cpu)
baseline="0"

type="release"
version=$(default_version)
revision=$(default_revision)
canary="0"
assertions="0"
lto="1"

llvm_version=$(default_llvm_version)
macos_version=$(default_macos_version)
cc_version=$(default_cc_version)
cc=$(default_cc)
cxx_version=$(default_cxx_version)
cxx=$(default_cxx)
ar=$(default_ar)
ld=$(default_ld)
ccache=$(default_ccache)

zig_version=$(default_zig_version)
zig=$(default_zig)

bun_version=$(default_bun_version)
bun=$(default_bun)

help() {
  pretty_ln "Script to build {pink}{bold}Bun {reset}from source.

Options:
  {cyan}-h{reset}, {cyan}--help{reset}               Print this help message and exit{reset}
  {cyan}--artifact{reset} {dim}[value]{reset}       Specify the artifact to build{reset}                        {dim}(default: {green}$artifact{reset}{dim}){reset}
  {cyan}--clean{reset}                  Specify if the build should be cleaned{reset}               {dim}(default: {yellow}$clean{reset}{dim}){reset}
  {cyan}-j{reset}, {cyan}--jobs{reset} {dim}[value]{reset}       Specify the number of jobs to run in parallel{reset}        {dim}(default: {yellow}$jobs{reset}{dim}){reset}
  {cyan}--ci{reset}                     Specify if this is a CI build{reset}                        {dim}(default: {yellow}$ci{reset}{dim}){reset}
  {cyan}--verbose{reset}                Specify if the build should be verbose{reset}               {dim}(default: {yellow}$verbose{reset}{dim}){reset}

  {cyan}--os{reset} {dim}[value]{reset}             Specify the operating system to target               {dim}(default: {green}$os{reset}{dim}){reset}
  {cyan}--arch{reset} {dim}[value]{reset}           Specify the architecture to target                   {dim}(default: {green}$arch{reset}{dim}){reset}
  {cyan}--cpu{reset} {dim}[value]{reset}            Specify the CPU target to build{reset}                      {dim}(default: {green}$cpu{reset}{dim}){reset}
  {cyan}--baseline{reset}               Specify if this is a baseline build{reset}                  {dim}(default: {yellow}$baseline{reset}{dim}){reset}

  {cyan}--debug{reset}, {cyan}--release{reset}       Specify if this is a debug or release build{reset}          {dim}(default: {green}$type{reset}{dim}){reset}
  {cyan}--version{reset} {dim}[semver]{reset}       Specify the version in {dim}bun --version{reset}                 {dim}(default: {yellow}$version{reset}{dim}){reset}
  {cyan}--revision{reset} {dim}[sha]{reset}         Specify the git commit in {dim}bun --revision{reset}             {dim}(default: {green}$revision{reset}{dim}){reset}
  {cyan}--canary{reset} {dim}[number]{reset}        Specify the build number of the canary build{reset}         {dim}(default: {yellow}$canary{reset}{dim}){reset}
  {cyan}--assertions{reset}             Specify if assertions should be enabled{reset}              {dim}(default: {yellow}$assertions{reset}{dim}){reset}
  {cyan}--lto{reset}, {cyan}--no-lto{reset}          Specify if link-time optimization should be enabled{reset}  {dim}(default: {yellow}$lto{reset}{dim}){reset}

  {cyan}--llvm-version{reset} {dim}[semver]{reset}  Specify the LLVM version to use{reset}                      {dim}(default: {yellow}$llvm_version{reset}{dim}){reset}
  {cyan}--macos-version{reset} {dim}[semver]{reset} Specify the minimum macOS version to target{reset}          {dim}(default: {yellow}$macos_version{reset}{dim}){reset}
  {cyan}--cc-version{reset} {dim}[number]{reset}    Specify the C standard to use{reset}                        {dim}(default: {yellow}$cc_version{reset}{dim}){reset}
  {cyan}--cxx-version{reset} {dim}[number]{reset}   Specify the C++ standard to use{reset}                      {dim}(default: {yellow}$cxx_version{reset}{dim}){reset}
  {cyan}--cc{reset} {dim}[path]{reset}              Specify the C compiler to use{reset}                        {dim}(default: {green}$cc{reset}{dim}){reset}
  {cyan}--cxx{reset} {dim}[path]{reset}             Specify the C++ compiler to use{reset}                      {dim}(default: {green}$cxx{reset}{dim}){reset}
  {cyan}--ar{reset} {dim}[path]{reset}              Specify the archiver to use{reset}                          {dim}(default: {green}$ar{reset}{dim}){reset}
  {cyan}--ld{reset} {dim}[path]{reset}              Specify the linker to use{reset}                            {dim}(default: {green}$ld{reset}{dim}){reset}

  {cyan}--zig-version{reset} {dim}[semver]{reset}   Specify the zig version to use{reset}                       {dim}(default: {yellow}$zig_version{reset}{dim}){reset}
  {cyan}--zig{reset} {dim}[path]{reset}             Specify the zig executable to use{reset}                    {dim}(default: {green}$zig{reset}{dim}){reset}

  {cyan}--bun-version{reset} {dim}[semver]{reset}   Specify the bun version to use{reset}                       {dim}(default: {yellow}$bun_version{reset}{dim}){reset}
  {cyan}--bun{reset} {dim}[path]{reset}             Specify the bun executable to use{reset}                    {dim}(default: {green}$bun{reset}{dim}){reset}
"
}

clean() {
  if [ "$clean" = "1" ]; then
    rm -rf "$1"
  fi
}

copy() {
  if [ ! -f "$1" ]; then
    error "file not found: $1"
  fi
  if [ ! -d "$2" ]; then
    mkdir -p "$(dirname "$2")"
  fi
  cp "$1" "$2"
  pretty_ln "{dim}-> {reset}{green}$2{reset}" 2>&1
}

cmake_setup() {
  case "$@" in
    *--pic*) export FORCE_PIC="1"; shift ;;
    *) shift ;;
  esac
  export CC="$cc"
  export CFLAGS="$(default_cc_flags)"
  export CXX="$cxx"
  export CXXFLAGS="$(default_cxx_flags)"
  export CMAKE_FLAGS="$(default_cmake_flags)"
  if [ "$os" = "darwin" ]; then
    export CMAKE_OSX_DEPLOYMENT_TARGET="$macos_version"
  fi
  # export LDFLAGS="$LDFLAGS -Wl,-z,norelro "
}

cmake_configure() {
  cmake -S "$1" -B "$2" ${CMAKE_FLAGS[@]} ${@:3}
}

cmake_build() {
  flags="--build $@"
  if [ "$type" = "debug" ]; then
    flags="$flags --config Debug"
  else
    flags="$flags --config Release"
  fi
  cmake ${flags[@]}
}

if_windows() {
  if [ "$os" = "windows" ]; then
    print "$1"
  else
    print "$2"
  fi
}

build_cares() {
  src_dir=$(path "$src_deps_dir" "c-ares")
  build_dir=$(path "$build_dir" "c-ares")
  clean $build_dir

  cmake_setup
  cmake_configure $src_dir $build_dir \
    -DCARES_STATIC=ON \
    -DCARES_STATIC_PIC=ON \
    -DCARES_SHARED=OFF
  cmake_build $build_dir \
    --target c-ares

  artifact=$(if_windows "cares.lib" "libcares.a")
  copy $(path "$build_dir" "lib" "$artifact") $(path "$build_deps_dir" "$artifact")
}

build_zstd() {
  src_dir=$(path "$src_deps_dir" "zstd" "build" "cmake")
  build_dir=$(path "$build_dir" "zstd")
  clean $build_dir

  cmake_setup
  cmake_configure $src_dir $build_dir \
    -DZSTD_BUILD_STATIC=ON
  cmake_build $build_dir \
    --target libzstd_static

  artifact=$(if_windows "zstd_static.lib" "libzstd.a")
  name=$(if_windows "zstd.lib" "libzstd.a")
  copy $(path "$build_dir" "lib" "$artifact") $(path "$build_deps_dir" "$name")
}

build_lshpack() {
  src_dir=$(path "$src_deps_dir" "ls-hpack")
  build_dir=$(path "$build_dir" "ls-hpack")
  clean $build_dir

  cmake_setup
  cmake_configure $src_dir $build_dir \
    -DLSHPACK_XXH=ON \
    -DSHARED=0
  cmake_build $build_dir

  artifact=$(if_windows "ls-hpack.lib" "libls-hpack.a")
  name=$(if_windows "lshpack.lib" "liblshpack.a")
  copy $(path "$build_dir" "$artifact") $(path "$build_deps_dir" "$name")
}

build_boringssl() {
  src_dir=$(path "$src_deps_dir" "boringssl")
  build_dir=$(path "$build_dir" "boringssl")
  clean $build_dir

  cmake_setup
  cmake_configure $src_dir $build_dir
  cmake_build $build_dir \
    --target crypto \
    --target ssl \
    --target decrepit

  artifact=$(if_windows "crypto.lib" "libcrypto.a")
  name=$(if_windows "ssl.lib" "libssl.a")
  copy $(path "$build_dir" "crypto" "$artifact") $(path "$build_deps_dir" "$name")

  artifact=$(if_windows "decrepit.lib" "libdecrepit.a")
  name=$(if_windows "decrepit.lib" "libdecrepit.a")
  copy $(path "$build_dir" "decrepit" "$artifact") $(path "$build_deps_dir" "$name")
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h | --help) help; exit 0 ;;
      --artifact) artifact="$2"; shift ;;
      --clean) clean="1"; shift ;;
      -j | --jobs) jobs="$2"; shift ;;
      --ci) ci="1"; shift ;;
      --verbose) verbose="1"; shift ;;

      --os) os="$2"; shift ;;
      --arch) arch="$2"; shift ;;
      --cpu) cpu="$2"; shift ;;
      --baseline) baseline="1"; shift ;;

      --version) version="$2"; shift ;;
      --revision) revision="$2"; shift ;;
      --canary) canary="1"; shift ;;
      --debug) type="debug"; shift ;;
      --assertions) assertions="1"; shift ;;
      --lto) lto="1"; shift ;;
      --no-lto) lto="0"; shift ;;

      --llvm-version) llvm_version="$2"; shift ;;
      --macos-version) macos_version="$2"; shift ;;
      --cc-version) cc_version="$2"; shift ;;
      --cxx-version) cxx_version="$2"; shift ;;
      --cc) cc="$2"; shift ;;
      --cxx) cxx="$2"; shift ;;
      --ar) ar="$2"; shift ;;
      --ld) ld="$2"; shift ;;
      --ccache) ccache="1"; shift ;;

      --zig-version) zig_version="$2"; shift ;;
      --zig) zig="$2"; shift ;;

      --bun-version) bun_version="$2"; shift ;;
      --bun) bun="$2"; shift ;;
      *) shift ;;
    esac
  done

  case "$artifact" in
    c*ares) build_cares ;;
    zstd) build_zstd ;;
    ls*hpack) build_lshpack ;;
    boring*ssl) build_boringssl ;;
    *) ;;
  esac
}

main "$@"
