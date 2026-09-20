$zip = "$env:TEMP\ccache.zip"
$extracted = "$env:TEMP\ccache"
Download $CCACHE_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path $CCACHE_DIR -ItemType Directory -Force | Out-Null
Copy-Item "$extracted\$CCACHE_ARCHIVE_ROOT\*" $CCACHE_DIR -Recurse -Force
Remove-Temp $zip $extracted
Add-To-Path $CCACHE_DIR
