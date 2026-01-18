@echo off
setlocal enabledelayedexpansion

REM Wrapper for llvm-lib that strips conflicting /machine:x64 flag for ARM64 builds
REM This is a workaround for CMake 4.1.0 bug

set NEWARGS=

for %%a in (%*) do (
    set "ARG=%%a"
    if /i "!ARG!"=="/machine:x64" (
        REM Skip /machine:x64 argument
    ) else (
        set "NEWARGS=!NEWARGS! %%a"
    )
)

"C:\Program Files\LLVM\bin\llvm-lib.exe" %NEWARGS%
exit /b %ERRORLEVEL%