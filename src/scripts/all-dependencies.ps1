$ErrorActionPreference = "Stop"
$FORCE = $false

$SCRIPT_DIR = Split-Path -Parent -Path $MyInvocation.MyCommand.Definition
$BUN_BASE_DIR = Join-Path -Path (Join-Path -Path $SCRIPT_DIR -ChildPath "..") -ChildPath ".."
$BUN_DEPS_OUT_DIR = Join-Path -Path $BUN_BASE_DIR -ChildPath "src\deps"

$CMAKE_FLAGS = "-DCMAKE_BUILD_TYPE=Release"

param (
    [switch]$FORCE
)

function dep {
    param (
        [string]$script,
        [string[]]$libs
    )

    if (-not $FORCE) {
        $HAS_ALL_DEPS = $true
        foreach ($lib in $libs) {
            $libPath = Join-Path -Path $BUN_DEPS_OUT_DIR -ChildPath $lib
            if (-not (Test-Path -Path $libPath -PathType Leaf)) {
                $HAS_ALL_DEPS = $false
                break
            }
        }
        if ($HAS_ALL_DEPS) {
            Write-Host "$script - already built"
            return
        }
    }

    Write-Host "building $script"

    & "$SCRIPT_DIR/build-$script.ps1"
    $EXIT = $LASTEXITCODE

    if ($EXIT -ne 0) {
        Write-Host "FAILED to build $script"
        exit $EXIT
    }
}

dep -script "base64" -libs "libbase64.a"
dep -script "boringssl" -libs "libcrypto.a", "libssl.a", "libdecrepit.a"
dep -script "cares" -libs "libcares.a"
dep -script "libarchive" -libs "libarchive.a"
dep -script "lolhtml" -libs "liblolhtml.a"
dep -script "mimalloc-debug" -libs "libmimalloc-debug.a"
dep -script "mimalloc" -libs "libmimalloc.a"
dep -script "tinycc" -libs "libtcc.a"
dep -script "zlib" -libs "libz.a"
dep -script "zstd" -libs "libzstd.a"