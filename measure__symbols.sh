#!/bin/bash
# usage: symbols.sh <binary> <out>
nm --defined-only "$1" 2>/dev/null | grep -E "12module_types$|9add_types$|11stated_type$|15bun_sema_driver13check_request$|___rust_alloc$|___rust_alloc_zeroed$|___rust_realloc$" > "$2"; wc -l "$2"
