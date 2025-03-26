#pragma once

#include "root.h"
#include <stdint.h>
#include <stdio.h>

void __bun_throw_not_implemented(const char* symbol_name);

#if OS(LINUX) || OS(DARWIN)

#define UV_EXTERN BUN_EXPORT

#include <uv.h>

#endif
