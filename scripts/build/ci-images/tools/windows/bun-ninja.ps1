$zip = "$env:TEMP\bun-ninja.zip"
Download $BUN_NINJA_URL $zip
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
if ($hash -ne $BUN_NINJA_SHA256) { Fail "bun-ninja's sha256 is $hash, expected $BUN_NINJA_SHA256" }
# Its own directory, not one on PATH: `ninja` there is Scoop's, and that is the one the build runs.
Expand-Archive -Path $zip -DestinationPath $BUN_NINJA_DIR -Force
Remove-Temp $zip
