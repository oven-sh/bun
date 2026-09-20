# Intel's emulator: runs the baseline x64 build on a CPU model without the
# newer instructions, to prove the build does not use them.
$archive = "$env:TEMP\sde.tar.xz"
$extracted = "$env:TEMP\sde"
Download $INTEL_SDE_URL $archive
$hash = (Get-FileHash $archive -Algorithm SHA256).Hash
if ($hash -ne $INTEL_SDE_SHA256) { Fail "Intel SDE's sha256 is $hash, expected $INTEL_SDE_SHA256" }
Run 7z x $archive "-o$extracted" -y | Out-Null
Run 7z x "$extracted\sde.tar" "-o$extracted" -y | Out-Null
Move-Item "$extracted\$INTEL_SDE_DIRECTORY" "C:\intel-sde" -Force
Remove-Temp $archive $extracted
