Set-Env SCOOP "C:\Scoop"
$installer = "$env:TEMP\install-scoop.ps1"
Download $SCOOP_INSTALL_URL $installer
& $installer -RunAsAdmin -ScoopDir C:\Scoop
Remove-Temp $installer
Add-To-Path "C:\Scoop\shims"
