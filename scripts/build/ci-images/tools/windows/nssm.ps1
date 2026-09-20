# The service manager scripts/agent.ts registers the agent with. There is no
# arm64 build; the x64 one runs under emulation.
$zip = "$env:TEMP\nssm.zip"
$extracted = "$env:TEMP\nssm"
Download $NSSM_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
Copy-Item "$extracted\$NSSM_DIRECTORY\win64\nssm.exe" "C:\Windows\System32\nssm.exe" -Force
Remove-Item $zip, $extracted -Recurse -Force

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { Fail "nssm is not on PATH" }
