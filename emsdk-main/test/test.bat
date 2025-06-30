:: equivalent of test.sh as windows bat file
set PATH=%PATH%;%PYTHON_BIN%
CALL emsdk install latest
CALL emsdk activate latest
CALL emsdk_env.bat
CALL python -c "import sys; print(sys.executable)"
CALL emcc.bat -v
