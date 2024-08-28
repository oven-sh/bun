#!/bin/bash

set -exo pipefail
cmake -B build -GNinja -DCMAKE_BUILD_TYPE=Debug
cmake --build build --verbose
