# This test installs emsdk and activates the latest toolchain using `--system` or `--permanent` flags,
# and checks if parts of PATH are lost or overwritten. Set $env:SYSTEM_FLAG and $env:PERMANENT_FLAG to test each.
# If no flag is provided the process/shell values are tested. See the CI file for an example.

refreshenv

$repo_root = [System.IO.Path]::GetDirectoryName((resolve-path "$PSScriptRoot"))

$PATH_USER_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$PATH_MACHINE_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$PATH_Process_BEFORE = [System.Environment]::GetEnvironmentVariable("PATH", "Process")

try {


    & "$repo_root/emsdk.ps1" install latest

    $esc = '--%'
    & "$repo_root/emsdk.ps1" activate latest $esc $env:PERMANENT_FLAG $env:SYSTEM_FLAG

    $PATH_USER = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $PATH_MACHINE = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    $PATH_Process = [System.Environment]::GetEnvironmentVariable("PATH", "Process")

    if ($env:SYSTEM_FLAG) {
        echo "--system test............................."
        $path_before_arr = $PATH_MACHINE_BEFORE.Split(';')
        $path_arr = $PATH_MACHINE.Split(';')
    }
    elseif ($env:PERMANENT_FLAG) {
        echo "--permanent test.........................."
        $path_before_arr = $PATH_USER_BEFORE.Split(';')
        $path_arr = $PATH_USER.Split(';')
    } else {
        echo "no flag test (shell/process).............."
        $path_before_arr = $PATH_Process_BEFORE.Split(';')
        $path_arr = $PATH_Process.Split(';')
    }


    $EMSDK_Path = $path_arr | Where-Object { $_ -like "$repo_root*" }
    $EMSDK_NODE_Path = $path_arr | Where-Object { $_ -like "$repo_root\node*" }
    $EMSDK_PYTHON_Path = $path_arr | Where-Object { $_ -like "$repo_root\python*" }
    $EMSDK_JAVA_Path = $path_arr | Where-Object { $_ -like "$repo_root\java*" }
    $EMSDK_UPSTREAM_Path = $path_arr | Where-Object { $_ -like "$repo_root\upstream\emscripten*" }

    $number_of_items = $path_arr.count
    [System.Collections.ArrayList]$rest_of_path = @()
    Foreach ($item in $path_arr) {
        if (
            ($item -like "$repo_root*") -or
            ($item -like "$repo_root\node*") -or
            ($item -like "$repo_root\python*") -or
            ($item -like "$repo_root\java*") -or
            ($item -like "$repo_root\upstream\emscripten*")
        ) {
            echo "$item is on the PATH"
        }
        else {
            $rest_of_path.add($item) | Out-Null
        }
    }

    # compare the PATHs before activation and after activation
    if (Compare-Object -ReferenceObject $path_before_arr -DifferenceObject $rest_of_path ) {
        echo "Old path is ............................."
        echo $path_before_arr
        echo "Current rest of path is ................."
        echo $rest_of_path
        throw "some parts of PATH are removed"
    }

    # Compare the other untouched PATH
    if ($env:SYSTEM_FLAG) {
        if (Compare-Object -ReferenceObject $PATH_USER_BEFORE.Split(';') -DifferenceObject $PATH_USER.Split(';') ) {
            echo "Old user path is ...................."
            echo $PATH_USER_BEFORE
            echo "Current user path is ................"
            echo $PATH_USER
            throw "User PATH are changed while --system had been provided"
        }
    }
    elseif ($env:PERMANENT_FLAG) {
        if (Compare-Object -ReferenceObject $PATH_MACHINE_BEFORE.Split(';') -DifferenceObject $PATH_MACHINE.Split(';') ) {
            echo "Old machine path is.................."
            echo $PATH_MACHINE_BEFORE
            echo "Current machine path is.............."
            echo $PATH_MACHINE
            throw "MACHINE PATH are changed while --system was not provided"
        }
    } else {
        if (
            (Compare-Object -ReferenceObject $PATH_MACHINE_BEFORE.Split(';') -DifferenceObject $PATH_MACHINE.Split(';')) -or
            (Compare-Object -ReferenceObject $PATH_MACHINE_BEFORE.Split(';') -DifferenceObject $PATH_MACHINE.Split(';'))
        ) {
            echo "Old machine path is.................."
            echo $PATH_MACHINE_BEFORE
            echo "Current machine path is.............."
            echo $PATH_MACHINE
            echo "Old user path is ...................."
            echo $PATH_USER_BEFORE
            echo "Current user path is ................"
            echo $PATH_USER
            throw "MACHINE/USER PATH are changed while no flag was provided"
        }
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
