# This test installs emsdk and activates the latest toolchain using `--system` or `--permanent` flags,
# and checks if the environment variables and PATH are correctly updated. Set $env:SYSTEM_FLAG and $env:PERMANENT_FLAG to test each.
# If no flag is provided the process/shell values are tested. See the CI file for an example.

refreshenv

$repo_root = [System.IO.Path]::GetDirectoryName((resolve-path "$PSScriptRoot"))

$PATH_USER_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$PATH_MACHINE_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$PATH_Process_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "Process")


try {

    & "$repo_root/emsdk.ps1" install latest

    & "$repo_root/emsdk.ps1" activate latest $env:PERMANENT_FLAG $env:SYSTEM_FLAG

    if ($env:SYSTEM_FLAG) {
        $env_type = "Machine"
    }
    elseif ($env:PERMANENT_FLAG) {
        $env_type = "User"
    } else {
        $env_type = "Process"
    }

    $EMSDK = [System.Environment]::GetEnvironmentVariable("EMSDK", $env_type)
    $EMSDK_NODE = [System.Environment]::GetEnvironmentVariable("EMSDK_NODE", $env_type)
    $EMSDK_PYTHON = [System.Environment]::GetEnvironmentVariable("EMSDK_PYTHON", $env_type)
    $PATH = [System.Environment]::GetEnvironmentVariable("PATH", $env_type)

    if (!$EMSDK) {
        throw "EMSDK is not set for the user"
    }
    if (!$EMSDK_NODE) {
        throw "EMSDK_NODE is not set for the user"
    }
    if (!$EMSDK_PYTHON) {
        throw "EMSDK_PYTHON is not set for the user"
    }


    $path_split = $PATH.Split(';')

    $EMSDK_Path = $path_split | Where-Object { $_ -like "$repo_root*" }
    if (!$EMSDK_Path) {
        throw "No path is added!"
    }

    $EMSDK_UPSTREAM_Path = $path_split | Where-Object { $_ -like "$repo_root\upstream\emscripten*" }
    if (!$EMSDK_UPSTREAM_Path) {
        throw "$repo_root\\upstream\emscripten is not added to path."
    }


}
finally {
    # Recover pre-split PATH
    refreshenv

    [Environment]::SetEnvironmentVariable("Path", $PATH_USER_BEFORE, "User")
    try {
        [Environment]::SetEnvironmentVariable("Path", $PATH_MACHINE_BEFORE, "Machine")
    }
    catch {}

    [Environment]::SetEnvironmentVariable("Path", $PATH_Process_BEFORE, "Process")

    # Recover pre activation env variables
    [Environment]::SetEnvironmentVariable("EMSDK", $null, "User")
    [Environment]::SetEnvironmentVariable("EMSDK_NODE", $null, "User")
    [Environment]::SetEnvironmentVariable("EMSDK_PYTHON", $null, "User")

    try {
        [Environment]::SetEnvironmentVariable("EMSDK", $null, "Machine")
        [Environment]::SetEnvironmentVariable("EMSDK_NODE", $null, "Machine")
        [Environment]::SetEnvironmentVariable("EMSDK_PYTHON", $null, "Machine")
    } catch {}


    [Environment]::SetEnvironmentVariable("EMSDK", $null, "Process")
    [Environment]::SetEnvironmentVariable("EMSDK_NODE", $null, "Process")
    [Environment]::SetEnvironmentVariable("EMSDK_PYTHON", $null, "Process")

    refreshenv
}
