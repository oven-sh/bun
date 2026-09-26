// Prints what a person runs ON A MAC to build the macOS loader stub and to
// test a packed file. Nothing here runs on Linux: a Mach-O executable cannot
// be linked without Apple's SDK, so the macOS stub is an INPUT of the packer
// (tools/pack.ts --macos-stub). A file packed without it says so on macOS and
// exits 1.
//
//   bun tools/mac-stub.ts             print the script
//   bun tools/mac-stub.ts --out FILE  write it to FILE (to copy to a Mac)
const D = "$"; // a literal dollar, so that sh parameter expansions survive String.raw
export const MAC_SCRIPT = String.raw`#!/bin/sh
# Builds the macOS loader stub of the portable image and tests a packed file.
# Run it on the Mac in a directory that holds
#   host_posix.c, linux_abi.h, memory.h   from misctools/portable/host, with
#                                         the patch of this job applied to
#                                         host_posix.c (host/host_posix.c.diff)
#   <packed file>                         named as the first argument
#
#     sh run-mac.sh threads-aarch64.com
#
# cc is the compiler of Xcode or of the Command Line Tools. Nothing else is
# needed: the stub is one file and uses libSystem only.
set -u
packed=${D}{1:-threads-aarch64.com}
case $(uname -m) in
arm64) stub=macos-stub-aarch64 ;;
x86_64) stub=macos-stub-x86_64 ;;
*) echo "unknown machine"; exit 1 ;;
esac
echo "host: $(uname -m) macOS $(sw_vers -productVersion), page $(getconf PAGESIZE)"

# 1. The stub IS the POSIX host of misctools/portable. On macOS it maps the
#    image out of the packed file and answers its Linux requests.
cc -O2 -Wall -Wno-unused-function -o "$stub" host_posix.c || exit 1

# 2. The stub is a normal Mach-O program and needs its own signature on Apple
#    Silicon. cc signs it ad-hoc already; this repeats it for older
#    toolchains and prints the bytes that go into the packed file.
codesign -f -s - "$stub"
ls -l "$stub"
shasum -a 256 "$stub"

# 3. Pack, with bun, on any machine (this Mac included). --macos-stub is what
#    makes the packed file start on macOS; --sign is the default for an
#    aarch64 image and is what lets Apple Silicon map its code from the file:
#      bun tools/pack.ts --arch aarch64 --image threads.img \
#        --win-host host-arm64.exe --linux-stub linux-stub-aarch64 \
#        --macos-stub $stub -o $packed

# 4. The start a user sees: the file is a shell script for /bin/sh, which puts
#    the stub in the cache directory and execs it with the path of the file.
#    42 is the pass code of the test image. /bin/sh on macOS is bash 3.2 in sh
#    mode; zsh is the login shell and is tested too.
chmod +x "$packed"
status=0; ./"$packed" /tmp/probe.tmp || status=$?; echo "run as a program: exit=$status"
status=0; sh "$packed" /tmp/probe.tmp || status=$?; echo "run with sh: exit=$status"
status=0; zsh "$packed" /tmp/probe.tmp || status=$?; echo "run with zsh: exit=$status"
cache=${D}{XDG_CACHE_HOME:-$HOME/.cache}/bun-portable
ls -l "$cache"

# 5. What the stub did. The image has to be "mapped from the file" at its
#    offset in the packed file, and on arm64 its code signature has to be
#    accepted, not refused.
BUN_HOST_TRACE=1 ./"$packed" /tmp/probe.tmp 2>&1 | grep '^\[host\]'

# 6. The arguments of the packed file are the arguments of the image.
./"$packed" /tmp/probe.tmp second third | grep -o 'argc=[0-9]*'

# 7. Five runs, to see that nothing is flaky.
pass=0; i=0
while [ $i -lt 5 ]; do
  i=$((i + 1)); status=0
  ./"$packed" /tmp/probe.tmp >/dev/null 2>&1 || status=$?
  if [ $status -eq 42 ]; then pass=$((pass + 1)); fi
done
echo "passes: $pass of 5"

# 8. The stub in the cache can be run by hand, which is all the header script
#    does, and it still takes a bare image file as it always did.
for s in "$cache"/stub-macos-*; do
  status=0; "$s" "$packed" /tmp/probe.tmp || status=$?; echo "stub by hand: exit=$status"
  status=0; "$s" threads.img /tmp/probe.tmp || status=$?; echo "bare image: exit=$status"
done

# Messages that mean the packed file, not the Mac, is at fault:
#   "was packed without a macos loader stub"   packed without --macos-stub
#   "the image has no code signature"          packed with --no-sign
#   "the code signature of the image was refused"   the signature does not
#     cover the image at the offsets it has in this packed file
#   "this file holds an image for aarch64"     the container is for the other
#     architecture (an arm64 Mac runs an x86_64 container under Rosetta only
#     if the container is the x86_64 one)
`;

if (import.meta.main) {
  const i = process.argv.indexOf("--out");
  if (i >= 0) await Bun.write(process.argv[i + 1], MAC_SCRIPT);
  else process.stdout.write(MAC_SCRIPT);
}
