#!/bin/bash

set -exo pipefail
cmake -B build -GNinja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_VERBOSE_MAKEFILE=ON -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build build --verbose
