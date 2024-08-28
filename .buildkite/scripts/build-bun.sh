#!/bin/bash

set -exo pipefail
cmake -B build -GNinja
cmake --build build --verbose
