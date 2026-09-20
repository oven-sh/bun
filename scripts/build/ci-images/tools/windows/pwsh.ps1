$msi = "$env:TEMP\pwsh.msi"
Download $PWSH_URL $msi
$process = Start-Process msiexec -ArgumentList "/i `"$msi`" /quiet /norestart ADD_PATH=1" -Wait -PassThru -NoNewWindow
if ($process.ExitCode -ne 0) { Fail "the PowerShell installer exited with code $($process.ExitCode)" }
Remove-Item $msi
Refresh-Path

$installed = pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
if ($installed -ne $PWSH_VERSION) { Fail "pwsh is $installed, expected $PWSH_VERSION" }
