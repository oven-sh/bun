@echo off
setlocal enabledelayedexpansion

REM Wrapper for llvm-lib that strips conflicting /machine:x64 flag for ARM64 builds
REM This is a workaround for CMake 4.1.0 bug

REM Find llvm-lib.exe - check LLVM_LIB env var, then PATH, then known locations
if defined LLVM_LIB (
    set "LLVM_LIB_EXE=!LLVM_LIB!"
) else (
    where llvm-lib.exe >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        for /f "delims=" %%i in ('where llvm-lib.exe') do set "LLVM_LIB_EXE=%%i"
    ) else if exist "C:\Program Files\LLVM\bin\llvm-lib.exe" (
        set "LLVM_LIB_EXE=C:\Program Files\LLVM\bin\llvm-lib.exe"
    ) else (
        echo Error: Cannot find llvm-lib.exe. Set LLVM_LIB environment variable or add LLVM to PATH.
        exit /b 1
    )
)

set "ARGS="

for %%a in (%*) do (
    set "ARG=%%a"
    if /i "!ARG!"=="/machine:x64" (
        REM Skip this argument
    ) else (
        set "ARGS=!ARGS! %%a"
    )
)

"!LLVM_LIB_EXE!" %ARGS%
exit /b %ERRORLEVEL%
