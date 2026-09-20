# Installed by openssh.ps1 and run at every start: the SSH keys of the GitHub
# organization's public members become the machine's administrator keys.
$members = Invoke-RestMethod -Uri "https://api.github.com/orgs/oven-sh/members" -Headers @{ "User-Agent" = "bun-ci" }
$keys = @()
foreach ($member in $members) {
  if ($member.type -ne "User" -or -not $member.login) { continue }
  $userKeys = (Invoke-WebRequest -Uri "https://github.com/$($member.login).keys" -UseBasicParsing).Content
  if ($userKeys) { $keys += $userKeys.Trim() }
}
if ($keys.Count -gt 0) {
  $keysPath = "C:\ProgramData\ssh\administrators_authorized_keys"
  Set-Content -Path $keysPath -Value ($keys -join "`n") -Force
  icacls $keysPath /inheritance:r /grant "SYSTEM:(F)" /grant "Administrators:(R)" | Out-Null
}
