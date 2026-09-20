$zip = "$env:TEMP\ccache.zip"
$extracted = "$env:TEMP\ccache"
$destination = "$env:ProgramFiles\ccache"
Download $CCACHE_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path $destination -ItemType Directory -Force | Out-Null
Copy-Item "$extracted\$CCACHE_DIRECTORY\*" $destination -Recurse -Force
Remove-Item $zip, $extracted -Recurse -Force
Add-To-Path $destination

$installed = (ccache --version | Select-Object -First 1)
if ($installed -ne "ccache version $CCACHE_VERSION") { Fail "ccache --version is '$installed', expected $CCACHE_VERSION" }
