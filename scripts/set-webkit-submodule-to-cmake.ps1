# Navigate to the parent directory of the script
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptPath\..
try {
    # Get the WEBKIT_TAG value from CMakeLists.txt
    $WEBKIT_TAG = Select-String -Path 'CMakeLists.txt' -Pattern 'set\(WEBKIT_TAG (.*?)\)' | ForEach-Object { $_.Matches.Groups[1].Value }
    if (-not $WEBKIT_TAG) {
        Write-Host "Could not find WEBKIT_TAG in CMakeLists.txt"
        exit 1
    }

    Write-Host "Setting WebKit submodule to $WEBKIT_TAG"

    # Navigate to the WebKit submodule directory
    Set-Location src/bun.js/WebKit

    # Fetch and reset the submodule to the specified tag
    git fetch origin "$WEBKIT_TAG"
    git reset --hard "$WEBKIT_TAG"
} finally {
    Pop-Location
}