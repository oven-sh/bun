# Server 2019's tar cannot read .tar.xz; 7-Zip unpacks it in two steps.
$archive = "$env:TEMP\curl-h3.tar.xz"
$extracted = "$env:TEMP\curl-h3"
Download $CURL_H3_URL $archive
Run 7z x $archive "-o$extracted" -y | Out-Null
Run 7z x "$extracted\curl-h3.tar" "-o$extracted" -y | Out-Null
Copy-Item "$extracted\curl.exe" "C:\Windows\System32\curl-h3.exe" -Force
Copy-Item "$extracted\curl-ca-bundle.crt" "C:\Windows\System32\curl-ca-bundle.crt" -Force
Remove-Temp $archive $extracted
Set-Env CURL_HTTP3 "C:\Windows\System32\curl-h3.exe"
