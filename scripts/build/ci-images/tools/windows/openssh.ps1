$zip = "$env:TEMP\OpenSSH.zip"
$extracted = "$env:TEMP\OpenSSH"
$destination = "$env:ProgramFiles\OpenSSH"
Download $OPENSSH_URL $zip
Expand-Archive -Path $zip -DestinationPath $extracted -Force
New-Item -Path $destination -ItemType Directory -Force | Out-Null
Get-ChildItem -Path (Get-ChildItem -Path $extracted -Directory | Select-Object -First 1).FullName -Recurse | Move-Item -Destination $destination -Force
Remove-Temp $zip $extracted
& "$destination\install-sshd.ps1"
& "$destination\FixHostFilePermissions.ps1" -Confirm:$false
Set-Service -Name sshd -StartupType Automatic

New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value (Get-Command pwsh).Path -PropertyType String -Force | Out-Null
New-NetFirewallRule -Profile Any -Name "OpenSSH-Server" -DisplayName "OpenSSH Server (sshd)" -Enabled True `
  -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null

# Keys only. sshd writes its default configuration the first time it starts.
Start-Service sshd
Stop-Service sshd
$config = "C:\ProgramData\ssh\sshd_config"
(Get-Content $config) -replace '#PubkeyAuthentication yes', 'PubkeyAuthentication yes' -replace 'PasswordAuthentication yes', 'PasswordAuthentication no' | Set-Content $config

# Whoever is a public member of the GitHub organization can log in: their
# keys are fetched each time the machine starts.
Copy-Item "$BAKE_DIR\fetch-ssh-keys.ps1" "C:\ProgramData\ssh\fetch-ssh-keys.ps1" -Force
$action = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"C:\ProgramData\ssh\fetch-ssh-keys.ps1`""
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "FetchSshKeys" -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
