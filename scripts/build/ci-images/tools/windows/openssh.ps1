$zip = "$env:TEMP\OpenSSH.zip"
$extracted = "$env:TEMP\OpenSSH"
Download $OPENSSH_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path $OPENSSH_DIR -ItemType Directory -Force | Out-Null
Get-ChildItem -Path (Get-ChildItem -Path $extracted -Directory | Select-Object -First 1).FullName -Recurse | Move-Item -Destination $OPENSSH_DIR -Force
Remove-Temp $zip $extracted
& "$OPENSSH_DIR\install-sshd.ps1"
& "$OPENSSH_DIR\FixHostFilePermissions.ps1" -Confirm:$false
Set-Service -Name sshd -StartupType Automatic

New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value (Get-Command pwsh).Path -PropertyType String -Force | Out-Null
New-NetFirewallRule -Profile Any -Name "OpenSSH-Server" -DisplayName "OpenSSH Server (sshd)" -Enabled True `
  -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null

# Keys only. sshd writes its default configuration the first time it starts,
# and both settings are commented out in it. That start also makes the host
# keys, which must not be in the image: every machine started from it would
# have the same ones. sshd makes new ones when it finds none.
Start-Service sshd
Stop-Service sshd
Remove-Item "C:\ProgramData\ssh\ssh_host_*" -Force
$config = "C:\ProgramData\ssh\sshd_config"
(Get-Content $config) -replace '^#?PubkeyAuthentication .*', 'PubkeyAuthentication yes' -replace '^#?PasswordAuthentication .*', 'PasswordAuthentication no' | Set-Content $config

# Whoever is a public member of the GitHub organization can log in: their
# keys are fetched each time the machine starts.
Copy-Item "$BAKE_DIR\fetch-ssh-keys.ps1" "C:\ProgramData\ssh\fetch-ssh-keys.ps1" -Force
$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"C:\ProgramData\ssh\fetch-ssh-keys.ps1`""
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "FetchSshKeys" -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
