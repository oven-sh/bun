#!/bin/sh
# This script detects the current operating system, and installs
# Bun according to that OS's conventions.

# References:
# https://www.shellcheck.net/
# https://google.github.io/styleguide/shellguide.html
# https://sharats.me/posts/shell-script-best-practices

trap "exit 1" TERM
PID=$$

warn() {
  prettyln "{yellow}{bold}warn{reset}: $*{reset}" >&2
}

error() {
  prettyln "{red}{bold}error{reset}: $*{reset}" >&2
  kill -s TERM $PID
}

exists() {
  command -v "$1" > /dev/null 2>&1
}

lowercase() {
  if exists tr; then
    tr '[:upper:]' '[:lower:]'
  elif exists awk; then
    awk '{print tolower($0)}'
  else
    error "script requires command: 'tr' or 'awk'"
  fi
}

oneline() {
  if exists head; then
    head -n 1
  elif exists awk; then
    awk 'NR==1'
  elif exists sed; then
    sed -n '1p'
  else
    error "script requires command: 'head', 'awk', or 'sed'"
  fi
}

regex() {
  if exists grep; then
    # There are two versions of grep: GNU and BSD.
    # GNU grep supports -P, BSD grep supports -E.
    if grep --version 2>/dev/null | grep -q 'BSD' 2>/dev/null; then
      grep -Eo "$1"
    else
      grep -Po "$1"
    fi
  elif exists tr; then
    tr -dc "$1"
  else
    error "script requires command: 'grep' or 'tr'"
  fi
}

semver() {
  regex '[0-9]+\.[0-9]\.*[0-9]*' | oneline
}

sha256() {
  if exists sha256sum; then
    sha256sum | cut -d ' ' -f 1
  elif exists shasum; then
    shasum -a 256 | oneline
  elif exists openssl; then
    openssl dgst -sha256 | oneline
  fi
}

fetch() {
  if exists curl; then
    curl -fsSL "$1"
  elif exists wget; then
    wget -qO- "$1"
  else
    error "script requires command: 'curl' or 'wget'"
  fi
}

fetch_file() {
  if exists curl; then
    curl --progress-bar -fSL "$1" -o "$2" 
  elif exists wget; then
    wget --show-progress -O- "$1" -O "$2" 
  else
    error "script requires command: 'curl' or 'wget'"
  fi
}

os() {
  if exists uname; then
    uname -s
  elif [ -n "$OSTYPE" ]; then
    # shellcheck disable=SC3028
    printf "$OSTYPE"
  fi
}

arch() {
  if exists dpkg; then
    dpkg --print-architecture
  elif exists uname; then
    uname -m
  fi
}

distro() {
  if exists sw_vers; then
    sw_vers -productName
  elif exists lsb_release; then
    lsb_release -si
  elif [ -f /etc/os-release ]; then
    . /etc/os-release
    printf "$ID"
  fi
}

distro_version() {
  if exists sw_vers; then
    sw_vers -productVersion
  elif exists lsb_release; then
    lsb_release -sr
  elif [ -f /etc/os-release ]; then
    . /etc/os-release
    printf "$VERSION_ID"
  fi
}

kernel_version() {
  if exists uname; then
    uname -r | semver
  fi
}

cpu_flags() {
  if [ -f /proc/cpuinfo ]; then
    grep -Pi 'features|flags' < /proc/cpuinfo | oneline | sed 's/.*:\s*//'
  elif exists sysctl; then
    sysctl -n machdep.cpu.features 2>/dev/null | lowercase
  fi
}

is_baseline() {
  case "$(arch)" in
    x86_64 | amd64)
      case "$(cpu_flags)" in
        *avx2*) break ;;
        *) printf "1" ;;
      esac
      ;;
  esac
}

glibc_version() {
  if exists ldd; then
    ldd --version | semver
  fi
}

musl_version() {
  if exists apk; then
    apk info musl 2>/dev/null | semver
  fi
}

wsl_version() {
  if exists uname; then
    case "$(uname -r)" in
      *wsl2*) printf "2"; break ;;
      *microsoft*) printf "1" ;;
      *) ;;
    esac
  fi
}

bun_version() {
  if exists bun; then
    # Old versions of Bun don't support --revision, instead it prints the help page.
    # If "Usage" is in the output, it's probably the help page, so use --version instead.
    if bun --revision | regex 'Usage' >/dev/null; then
      bun --version
    else
      bun --revision
    fi
  fi
}

is_rosetta() {
  if exists sysctl && sysctl -n sysctl.proc_translated >/dev/null 2>&1 = "1"; then
    printf "1"
  fi
}

is_ci() {
  if [ "$GITHUB_ACTIONS" = "true" ]; then
    printf "github"
  elif [ "$GITLAB_CI" = "true" ]; then
    printf "gitlab"
  elif [ -n "$BITBUCKET_BUILD_NUMBER" ]; then
    printf "bitbucket"
  elif [ "$TRAVIS" = "true" ]; then
    printf "travis"
  elif [ "$CIRCLECI" = "true" ]; then
    printf "circleci"
  elif [ "$BUILDKITE" = "true" ]; then
    printf "buildkite"
  elif [ -n "$TEAMCITY_VERSION" ]; then
    printf "teamcity"
  elif [ -n "$CI_NAME" ]; then
    printf "$CI_NAME" | lowercase
  elif [ "$CI" = "true" ] || [ "$CI" = "1" ]; then
    printf "1"
  fi
}

is_docker() {
  if [ -f /.dockerenv ] || [ -f /run/.containerenv ] || [ -f /proc/1/cgroup ] && regex 'docker' >/dev/null < /proc/1/cgroup; then
    printf "1"
  fi
}

version() {
  if exists "$1"; then
    "$1" --version | semver
  fi
}

detect_target() {
  os=$(os | lowercase)
  case "$os" in
    darwin*)
      os="darwin" ;;
    linux*)
      os="linux" ;;
    win32 | msys* | mingw* | cygwin*)
      os="windows" ;;
    *)
      error "unsupported operating system: $os" ;;
  esac
  arch=$(arch | lowercase)
  if [ "$os" = "darwin" ] && [ "$(is_rosetta)" = "1" ]; then
    arch="aarch64"
  fi
  case "$arch" in
    x86_64 | amd64)
      arch="x64" ;;
    aarch64 | arm64)
      arch="aarch64" ;;
    *)
      error "unsupported architecture: $arch" ;;
  esac
  baseline="$1"
  if [ "$arch" = "x64" ]; then
    case "$(cpu_flags)" in
      *avx2*) ;;
      *) baseline="1" ;;
    esac
  else
    baseline="0"
  fi
  target="$os-$arch"
  if [ "$baseline" = "1" ]; then
    target="$target-baseline"
  fi
  profile="$2"
  if [ "$profile" = "1" ]; then
    target="$target-profile"
  fi
  printf "$target"
}

detect_release() {
  case "$1" in
    latest | stable)
      latest=$(fetch "https://raw.githubusercontent.com/oven-sh/bun/main/LATEST" 2>/dev/null)
      if [ -z "$latest" ]; then
        printf "latest"
      else
        printf "bun-v$latest"
      fi
      ;;
    canary | beta)
      printf "canary"
      ;;
    *)
      version=$(printf "$1" | semver)
      if [ -z "$version" ]; then
        error "invalid version: $1"
      fi
      tag="bun-v$version"
      release=$(fetch "https://api.github.com/repos/oven-sh/bun/releases/tags/$tag" 2>/dev/null)
      if [ -z "$release" ]; then
        error "release not found: $tag"
      else
        printf "$tag"
      fi
      ;;
  esac
}

is_color() {
  printf "1"
  # if [ "$NO_COLOR" = "1" ] || [ ! -t 1 ]; then
  #   printf "0"
  # elif exists tput; then
  #   printf "1"
  #   # tput colors >/dev/null 2>&1
  # else
  #   printf "1"
  # fi
}

ansi() {
  # https://en.wikipedia.org/wiki/ANSI_escape_code#Colors
  case "$1" in
    reset) printf "\033[0m" ;;
    bold) printf "\033[1m" ;;
    dim) printf "\033[2m" ;;
    red) printf "\033[31m" ;;
    green) printf "\033[32m" ;;
    yellow) printf "\033[33m" ;;
    pink) printf "\033[35m" ;;
    cyan) printf "\033[36m" ;;
    *) ;;
  esac
}

pretty() {
  string="$1"
  for color in reset bold dim red green yellow pink cyan; do
    code=$(ansi "$color")
    string=$(printf "$string" | sed -e "s/{$color}/$code/g")
  done
  printf "$string"
}

prettyln() {
  pretty "$1"
  printf "\n"
}

dump() {
  prettyln "{dim}========={reset} {bold}Machine Info{reset} {dim}========={reset}
{dim}Operating System:{reset} {green}$(os){reset}
{dim}Architecture:{reset} {green}$(arch){reset}
{dim}Distro:{reset} {green}$(distro) $(distro_version){reset}
{dim}Kernel:{reset} {yellow}$(kernel_version){reset}
{dim}CPU Flags:{reset} {green}$(cpu_flags){reset}
{dim}Rosetta:{reset} {yellow}$(is_rosetta){reset}
{dim}Glibc:{reset} {yellow}$(glibc_version){reset}
{dim}Musl:{reset} {yellow}$(musl_version){reset}
{dim}WSL:{reset} {yellow}$(wsl_version){reset}
{dim}Docker:{reset} {yellow}$(is_docker){reset}
{dim}CI:{reset} {green}$(is_ci){reset}
{dim}Bun:{reset} {pink}$(bun_version){reset}
{dim}Node:{reset} {yellow}$(version node){reset}
{dim}==============================={reset}
"
}

help() {
  prettyln "Script that installs {reset}{pink}{bold}Bun {reset}on your machine.{reset}

{bold}Options:{reset}
  {cyan}-h{reset}, {cyan}--help{reset}                Print this help message.{reset}
  {cyan}--latest{reset}                  Install the latest version of Bun. {reset}{dim}(default){reset}
  {cyan}-v{reset}, {cyan}--version{reset} {reset}{dim}[version]{reset}   Install a specific version of Bun. {reset}{dim}(example: '1.0.0', 'bun-v1.0.0', 'latest'){reset}
  {cyan}--canary{reset}                  Install the canary version of Bun.{reset}
  {cyan}--profile{reset}                 Install the version of Bun with debug symbols.{reset}
  {cyan}--baseline{reset}                Install the version of Bun for older machines.{reset}
  {cyan}--download-url {reset}{dim}[url]{reset}      Download Bun from a custom URL.{reset}
  {cyan}--pr {reset}{dim}[pr]{reset}                Download Bun from a custom pull request.{reset}
  {cyan}--dump{reset}                    Print information about your machine.{reset}
"
}

download_bun() {
  if ! exists unzip; then
    error "unzip is required to download bun"
  fi

  version="$1"
  baseline="$2"
  profile="$3"
  url="$4"

  if [ -z "$url" ]; then
    target=$(detect_target "$baseline" "$profile")
    release=$(detect_release "$version")
    if [ "$release" = "latest" ]; then
      url="https://github.com/oven-sh/bun/releases/latest/download/bun-$target.zip"
    else
      url="https://github.com/oven-sh/bun/releases/download/$release/bun-$target.zip"
    fi
    prettyln "Downloading {pink}{bold}Bun {reset}from GitHub...
  {dim}Release: {reset}{green}$release{reset}
  {dim}Target: {reset}{green}$target{reset}
  {dim}URL: {green}$url{reset}
"
  else
    prettyln "Downloading {pink}{bold}Bun{reset} from URL...
  {dim}URL: {reset}{green}$url{reset}
"
  fi

  exe_name=bun
  if [ "$profile" = "1" ]; then
    exe_name=bun-profile
  fi

  tmp_dir=$(mktemp -d)
  tmp_zip="$tmp_dir/bun.zip"
  fetch_file "$url" "$tmp_zip" || error "failed to download bun"
  unzip -oqd "$tmp_dir" "$tmp_zip" || error "failed to unzip bun"
  tmp_exe=$(find "$tmp_dir" -type f -name "$exe_name")
  if [ -z "$tmp_exe" ]; then
    error "failed to find bun executable in downloaded zip"
  fi

  install_env=BUN_INSTALL
  bin_env=\$$install_env/bin
  install_dir=${!install_env:-$HOME/.bun}
  bin_dir=$install_dir/bin
  exe=$bin_dir/bun
  mv "$tmp_exe" "$exe" || error "failed to move bun to destination"
  chmod +x "$exe" || error "failed make bun executable"

  rm -rf "$tmp_dir"

  prettyln ""
}

main() {
  version="latest"
  profile="0"
  baseline="0"
  download_url=""
  if exists getopt; then
    options=$(getopt -o h -l help,dump,latest,stable,canary,profile,baseline,download-url: -- "$@")
    while [ $# -gt 0 ]; do
      case "$1" in
        -h | --help) help; exit 0 ;;
        --dump) dump; exit 0 ;;
        -v | --version) version="$2"; shift 2 ;;
        --latest | --stable) version="latest"; shift ;;
        --canary) version="canary"; shift ;;
        --profile) profile="1"; shift ;;
        --baseline) baseline="1"; shift ;;
        --download-url) download_url="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
  fi
  download_bun "$version" "$baseline" "$profile" "$download_url"
}

main "$@"
