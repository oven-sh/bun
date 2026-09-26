// Prints what a person runs ON REAL WINDOWS to build the Windows host and to
// test a packed file. Nothing here runs on Linux: the Windows host is an
// INPUT FILE of the packer, built natively with clang for the MSVC target.
//
//   bun tools/windows-host.ts             print the script
//   bun tools/windows-host.ts --out FILE  write it to FILE
export const WINDOWS_SCRIPT = String.raw`# PowerShell 7 on Windows. Run it in a Visual Studio developer shell, so that
# clang finds the Windows SDK and the UCRT:
#
#     Import-Module "$env:ProgramFiles\Microsoft Visual Studio\2022\Community\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
#     Enter-VsDevShell -VsInstallPath "$env:ProgramFiles\Microsoft Visual Studio\2022\Community" -Arch amd64 -HostArch amd64
#
# The three files this needs, from misctools/portable: host\host_win.c,
# host\linux_abi.h, host\memory.h.

# 1. Build the host for both architectures. -O2 only; the host is one file.
#    /Brepro makes lld write a fixed TimeDateStamp, so that two builds of the
#    same source give the same bytes, which is what keeps the whole packed
#    file reproducible.
clang -O2 -Wall -Wno-unused-function --target=x86_64-pc-windows-msvc  -Wl,/Brepro -o host-x64.exe   host\host_win.c
clang -O2 -Wall -Wno-unused-function --target=aarch64-pc-windows-msvc -Wl,/Brepro -o host-arm64.exe host\host_win.c
Get-FileHash host-x64.exe, host-arm64.exe | Format-Table Hash, Path

# 2. Pack, with bun, on this machine or anywhere else. The host of the
#    architecture of the image becomes the front of the container.
bun tools/pack.ts --arch x86_64 --image threads.img --win-host host-x64.exe --linux-stub linux-stub-x86_64 -o threads-x86_64.com

# 3. The packed file IS the executable. Windows needs an extension it knows:
#    .com and .exe are both in $env:PATHEXT, so either name runs. Copy it to
#    .exe as well, to see that nothing depends on the name.
Copy-Item threads-x86_64.com threads-x86_64.exe
.\threads-x86_64.com probe.tmp ; "exit=$LASTEXITCODE"   # the test image exits 42
.\threads-x86_64.exe probe.tmp ; "exit=$LASTEXITCODE"

# 4. What the host did. "image at 0x30000" is the offset of the image in the
#    packed file (the table of contents says the same), and the code has to be
#    a file view, MEM_MAPPED: the image is mapped from the one file, not
#    copied out of it.
$env:BUN_HOST_TRACE = "1"
.\threads-x86_64.exe probe.tmp 2>&1 | Select-String '^\[host\]'
Remove-Item Env:\BUN_HOST_TRACE

# 5. The arguments of the packed file are the arguments of the image: in the
#    packed form there is no image argument, argv[0] is the container itself.
#    The test image prints argc.
.\threads-x86_64.exe probe.tmp second third | Select-String 'argc='

# 6. The host still takes a bare image file as its first argument, the way it
#    did before this change (two files instead of one).
.\host-x64.exe threads.img probe.tmp ; "exit=$LASTEXITCODE"

# 7. The packed file is a valid PE. The same checks the Linux side ran
#    statically, on the machine that runs it:
llvm-readobj --file-headers --sections --coff-imports --coff-basereloc --coff-load-config --unwind threads-x86_64.com > packed.readobj.txt
llvm-readobj --file-headers --sections --coff-imports --coff-basereloc --coff-load-config --unwind host-x64.exe      > host.readobj.txt
# and, if something looks wrong, the loader's own view:
#     Get-Item .\threads-x86_64.exe | Format-List
#     dumpbin /headers .\threads-x86_64.exe

# 8. Ten runs, to see that nothing is flaky.
$pass = 0
1..10 | ForEach-Object { .\threads-x86_64.exe probe.tmp > $null 2>&1; if ($LASTEXITCODE -eq 42) { $pass++ } }
"passes: $pass of 10"

# Messages that mean the packed file, not the machine, is at fault:
#   "usage: host <image> [args]"     the table of contents was not found and
#                                    no image argument was given: the file is
#                                    not packed, or its last 128 bytes are not
#                                    a BUNPACK1 table of contents
#   "is an image for another processor"  the container holds the image of the
#                                    other architecture
#   "segment N is not aligned to 64 KiB"  the image does not lie on a 64 KiB
#                                    boundary in the container
#   "cannot create an executable file mapping"  the file could not be mapped
#                                    executable (antivirus, or a file system
#                                    that refuses it)
`;

if (import.meta.main) {
  const i = process.argv.indexOf("--out");
  if (i >= 0) await Bun.write(process.argv[i + 1], WINDOWS_SCRIPT);
  else process.stdout.write(WINDOWS_SCRIPT);
}
