#!/bin/bash

source $(dirname $0)/env.sh

exec python3 $EMSCRIPTEN/emar.py "$@"
