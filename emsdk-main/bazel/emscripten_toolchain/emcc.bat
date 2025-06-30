@ECHO OFF

call %~dp0\env.bat

py -3 %EMSCRIPTEN%\emcc.py %*
