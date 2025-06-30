$ScriptDirectory = Split-Path -parent $PSCommandPath

$PythonLocations = $(
    "python\3.13.3-0_64bit\python.exe",
    "python\3.9.2-1_64bit\python.exe",
    "python\3.9.2-nuget_64bit\python.exe"
)

# Find python from an explicit location relative to the Emscripten SDK.
foreach ($Location in $PythonLocations) {
    $FullLocation = Join-Path $ScriptDirectory $Location
    if (Test-Path $FullLocation) {
        $EMSDK_PY = $FullLocation
        break
    }
}

# As a last resort, access from PATH.
if (-Not $EMSDK_PY) {
    $EMSDK_PY = "python"
}

# Tell EMSDK to create environment variable setter as a .ps1 file
$env:EMSDK_POWERSHELL = 1

& $EMSDK_PY "$ScriptDirectory/emsdk.py" $args

# python is not able to set environment variables to the parent calling process, so
# therefore have it craft a .ps1 file, which we invoke after finishing python execution,
# to set up the environment variables
if (Test-Path $ScriptDirectory/emsdk_set_env.ps1) {
    & $ScriptDirectory/emsdk_set_env.ps1
    Remove-Item $ScriptDirectory/emsdk_set_env.ps1
}

Remove-Item Env:\EMSDK_POWERSHELL
