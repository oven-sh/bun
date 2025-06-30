#!/bin/bash

source $(dirname $0)/env.sh

exec python3 $(dirname $0)/link_wrapper.py "$@"
