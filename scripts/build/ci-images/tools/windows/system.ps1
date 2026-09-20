# Real-time scanning of every file a build writes costs more than the build.
Set-MpPreference -DisableRealtimeMonitoring $true
Add-MpPreference -ExclusionPath "C:\", "D:\"

# Windows 11's Smart App Control blocks unsigned executables, which is what tests build.
$smartAppControl = "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy"
if (Test-Path $smartAppControl) {
  Set-ItemProperty -Path $smartAppControl -Name "VerifiedAndReputablePolicyState" -Value 0 -Type DWORD
  if (Get-Command CiTool -ErrorAction SilentlyContinue) {
    CiTool --refresh -json | Out-Null
  }
}

$threatProtection = "HKLM:\SOFTWARE\Policies\Microsoft\Windows Advanced Threat Protection"
if (Test-Path $threatProtection) {
  Set-ItemProperty -Path $threatProtection -Name "ForceDefenderPassiveMode" -Value 1 -Type DWORD
}

# Search indexing, Windows Update, telemetry, WAP push, the compatibility
# assistant and Superfetch. A Windows edition that lacks one has nothing to stop.
foreach ($service in $DISABLED_SERVICES.Split(" ")) {
  if (Get-Service $service -ErrorAction SilentlyContinue) {
    Stop-Service $service -Force
    Set-Service $service -StartupType Disabled
  }
}

# The "High performance" power plan, and nothing ever sleeps.
Run powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c
foreach ($timeout in "monitor-timeout-ac", "monitor-timeout-dc", "standby-timeout-ac", "standby-timeout-dc", "hibernate-timeout-ac", "hibernate-timeout-dc") {
  Run powercfg /change $timeout 0
}
