$zip = "$env:TEMP\buildkite-agent.zip"
$extracted = "$env:TEMP\buildkite-agent"
Download $BUILDKITE_AGENT_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path "$AGENT_HOME\bin", "$AGENT_HOME\hooks" -ItemType Directory -Force | Out-Null
Copy-Item "$extracted\buildkite-agent.exe" "$AGENT_HOME\bin\buildkite-agent.exe" -Force
Remove-Temp $zip $extracted
Add-To-Path "$AGENT_HOME\bin"

# One checkout directory for every job, so compiler caches keyed on paths hit.
Set-Content -Path "$AGENT_HOME\hooks\environment.ps1" -Encoding UTF8 -Value "`$env:BUILDKITE_BUILD_CHECKOUT_PATH = `"$AGENT_HOME\build`""
