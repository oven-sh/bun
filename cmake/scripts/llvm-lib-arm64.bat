@echo off
setlocal enabledelayedexpansion

REM Wrapper for llvm-lib that strips conflicting /machine:x64 flag for ARM64 builds
REM This is a workaround for CMake 4.1.0 bug

set "ARGS="
set "SKIP_NEXT="

for %%a in (%*) do (
    set "ARG=%%a"
    if /i "!ARG!"=="/machine:x64" (
        REM Skip this argument
    ) else (
        set "ARGS=!ARGS! %%a"
    )
)

"C:\Program Files\LLVM\bin\llvm-lib.exe" %ARGS%
exit /b %ERRORLEVEL%
