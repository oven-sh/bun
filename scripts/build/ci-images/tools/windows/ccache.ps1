$zip = "$env:TEMP\ccache.zip"
$extracted = "$env:TEMP\ccache"
$destination = "$env:ProgramFiles\ccache"
Download $CCACHE_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path $destination -ItemType Directory -Force | Out-Null
Copy-Item "$extracted\$CCACHE_DIRECTORY\*" $destination -Recurse -Force
Remove-Temp $zip $extracted
Add-To-Path $destination
