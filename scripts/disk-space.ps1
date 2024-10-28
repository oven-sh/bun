# Get initial free space for comparison
$beforeFree = (Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace / 1GB

Write-Host "Starting disk cleanup..."
Write-Host "Initial free space: $([math]::Round($beforeFree, 2)) GB"

# Clear Windows Temp folders
Write-Host "Cleaning Windows temp folders..."
Remove-Item -Path "C:\Windows\Temp\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:TEMP\*" -Recurse -Force -ErrorAction SilentlyContinue

# Clear BuildKite artifacts and caches
Write-Host "Cleaning BuildKite artifacts..."
$buildkitePaths = @(
    "C:\BuildKite\builds",
    "C:\BuildKite\artifacts",
    "$env:USERPROFILE\.buildkite-agent\artifacts"
)
foreach ($path in $buildkitePaths) {
    if (Test-Path $path) {
        Remove-Item -Path "$path\*" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Clear package manager caches
Write-Host "Cleaning package manager caches..."
# NuGet
Remove-Item -Path "$env:USERPROFILE\.nuget\packages" -Recurse -Force -ErrorAction SilentlyContinue
# npm
Remove-Item -Path "$env:USERPROFILE\AppData\Roaming\npm-cache" -Recurse -Force -ErrorAction SilentlyContinue
# yarn
Remove-Item -Path "$env:USERPROFILE\AppData\Local\Yarn\Cache" -Recurse -Force -ErrorAction SilentlyContinue
# bun
Remove-Item -Path "$env:AppData\bun\install\cache" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$env:LocalAppData\bun\install\cache" -Recurse -Force -ErrorAction SilentlyContinue

# Clean Docker
Write-Host "Cleaning Docker resources..."
if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker system prune -af
}

# Empty Recycle Bin
Write-Host "Emptying Recycle Bin..."
Clear-RecycleBin -Force -ErrorAction SilentlyContinue

# Run Windows Disk Cleanup utility
Write-Host "Running Windows Disk Cleanup..."
cleanmgr /sagerun:1 /autoclean

# Get final free space and calculate difference
$afterFree = (Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace / 1GB
$spaceRecovered = $afterFree - $beforeFree

Write-Host "`nCleanup completed!"
Write-Host "Final free space: $([math]::Round($afterFree, 2)) GB"
Write-Host "Space recovered: $([math]::Round($spaceRecovered, 2)) GB"