# Stubbing UV symbols

Your task:

1. Pick the next symbol from the list below
2. Find the symbol's declaration in `src/bun.js/bindings/libuv/**/*.h`
3. Create a file in `src/bun.js/bindings/uv-mocks/<SYMBOL_NAME>.cpp`
4. Write the following code in that new file:

```cpp
#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)

<function_declaration_signature_GOES_HERE> {
  __bun_throw_not_implemented(SYMBOL_HNAME_AS_STRING);
  __builtin_unreachable();
}

#endif
```

5. Tick the symbol as completed from the list below
6. Await further instructions

# TODO: UV symbols

THE SYMBOLS GO HERE

## Appendix: The code inside `uv-posix-polyfills.h`

```cpp
#pragma once

#include "root.h"
#include <stdint.h>
#include <stdio.h>

void __bun_throw_not_implemented(const char* symbol_name);

#if OS(LINUX) || OS(DARWIN)

#define UV_EXTERN BUN_EXPORT

#include <uv.h>

#endif
```
