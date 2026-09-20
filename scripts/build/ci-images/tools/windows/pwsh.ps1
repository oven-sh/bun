$msi = "$env:TEMP\pwsh.msi"
Download $PWSH_URL $msi
$process = Start-Process msiexec -ArgumentList "/i `"$msi`" /quiet /norestart ADD_PATH=1" -Wait -PassThru -NoNewWindow
if ($process.ExitCode -ne 0) { Fail "the PowerShell installer exited with code $($process.ExitCode)" }
Remove-Temp $msi
Refresh-Path
