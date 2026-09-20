$zip = "$env:TEMP\bun.zip"
$extracted = "$env:TEMP\bun"
Download $BUN_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
Copy-Item "$extracted\$BUN_TRIPLET\bun.exe" "C:\Windows\System32\bun.exe" -Force
Remove-Item $zip, $extracted -Recurse -Force

$installed = bun --version
if ($installed -ne $BUN_VERSION) { Fail "bun --version is $installed, expected $BUN_VERSION" }
