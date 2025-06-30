#!/bin/bash

export ROOT_DIR=${EXT_BUILD_ROOT:-$(pwd -P)}
export EMSCRIPTEN=$ROOT_DIR/$EM_BIN_PATH/emscripten
export EM_CONFIG=$ROOT_DIR/$EM_CONFIG_PATH
