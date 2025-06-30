#!/usr/bin/env bash
set -ex

if [ $EUID -eq 0 ]; then
  sudo -u nobody `which emcc` --version
fi

which emsdk
node --version
npm --version
python3 --version
pip3 --version
em++ --version
emcc --version
java -version
cmake --version

exit_code=0

# test emcc compilation
echo 'int main() { return 0; }' | emcc -o /tmp/main.js -xc -
node /tmp/main.js || exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo "Node exited with non-zero exit code: $exit_code"
  exit $exit_code
fi

# test embuilder
embuilder build zlib --force
