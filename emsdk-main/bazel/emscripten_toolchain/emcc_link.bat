@ECHO OFF

call %~dp0\env.bat

py -3 %~dp0\link_wrapper.py %*
