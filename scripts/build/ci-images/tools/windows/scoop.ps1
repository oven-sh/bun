Set-Env SCOOP $SCOOP
$installer = "$env:TEMP\install-scoop.ps1"
Download $SCOOP_INSTALL_URL $installer
& $installer -RunAsAdmin -ScoopDir $SCOOP
Remove-Temp $installer
Add-To-Path "$SCOOP\shims"
