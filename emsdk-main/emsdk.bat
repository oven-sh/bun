@echo off

:: Find python from an explicit location relative to the Emscripten SDK.

setlocal

:: When using our bundled python we never want the users
:: PYTHONHOME or PYTHONPATH
:: https://github.com/emscripten-core/emsdk/issues/598

if exist "%~dp0python\3.13.3-0_64bit\python.exe" (
  set EMSDK_PY="%~dp0python\3.13.3-0_64bit\python.exe"
  set PYTHONHOME=
  set PYTHONPATH=
  goto end
)

if exist "%~dp0python\3.9.2-1_64bit\python.exe" (
  set EMSDK_PY="%~dp0python\3.9.2-1_64bit\python.exe"
  set PYTHONHOME=
  set PYTHONPATH=
  goto end
)

if exist "%~dp0python\3.9.2-nuget_64bit\python.exe" (
  set EMSDK_PY="%~dp0python\3.9.2-nuget_64bit\python.exe"
  set PYTHONHOME=
  set PYTHONPATH=
  goto end
)

:: As a last resort, access from PATH.
set EMSDK_PY=python

:end
call %EMSDK_PY% "%~dp0\emsdk.py" %*

endlocal

:: python is not able to set environment variables to the parent calling
:: process, so therefore have it craft a .bat file, which we invoke after
:: finishing python execution, to set up the environment variables
if exist "%~dp0\emsdk_set_env.bat" (
  call "%~dp0\emsdk_set_env.bat" > nul
  del /F /Q "%~dp0\emsdk_set_env.bat"
)
