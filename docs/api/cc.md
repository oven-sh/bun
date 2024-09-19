`bun:ffi` has experimental support for compiling and running C from JavaScript with low overhead.

## Usage (cc in `bun:ffi`)

See the [introduction blog post](https://bun.sh/blog/compile-and-run-c-in-js) for more information.

JavaScript:

```ts#hello.js
import { cc } from "bun:ffi";
import source from "./hello.c" with { type: "file" };

const {
  symbols: { hello },
} = cc({
  source,
  symbols: {
    hello: {
      args: [],
      returns: "int",
    },
  },
});

console.log("What is the answer to the universe?", hello());
```

C source:

```c#hello.c
int hello() {
  return 42;
}
```

When you run `hello.js`, it will print:

```sh
$ bun hello.js
What is the answer to the universe? 42
```

Under the hood, `cc` uses [TinyCC](https://bellard.org/tcc/) to compile the C code and then link it with the JavaScript runtime, efficiently converting types in-place.

### Primitive types

The same `FFIType` values in [`dlopen`](/docs/api/ffi) are supported in `cc`.

| `FFIType`  | C Type         | Aliases                     |
| ---------- | -------------- | --------------------------- |
| cstring    | `char*`        |                             |
| function   | `(void*)(*)()` | `fn`, `callback`            |
| ptr        | `void*`        | `pointer`, `void*`, `char*` |
| i8         | `int8_t`       | `int8_t`                    |
| i16        | `int16_t`      | `int16_t`                   |
| i32        | `int32_t`      | `int32_t`, `int`            |
| i64        | `int64_t`      | `int64_t`                   |
| i64_fast   | `int64_t`      |                             |
| u8         | `uint8_t`      | `uint8_t`                   |
| u16        | `uint16_t`     | `uint16_t`                  |
| u32        | `uint32_t`     | `uint32_t`                  |
| u64        | `uint64_t`     | `uint64_t`                  |
| u64_fast   | `uint64_t`     |                             |
| f32        | `float`        | `float`                     |
| f64        | `double`       | `double`                    |
| bool       | `bool`         |                             |
| char       | `char`         |                             |
| napi_env   | `napi_env`     |                             |
| napi_value | `napi_value`   |                             |

### Strings, objects, and non-primitive types

To make it easier to work with strings, objects, and other non-primitive types that don't map 1:1 to C types, `cc` supports N-API.

To pass or receive a JavaScript values without any type conversions from a C function, you can use `napi_value`.

You can also pass a `napi_env` to receive the N-API environment used to call the JavaScript function.

#### Returning a C string to JavaScript

For example, if you have a string in C, you can return it to JavaScript like this:

```ts#hello.js
import { cc } from "bun:ffi";
import source from "./hello.c" with { type: "file" };

const {
  symbols: { hello },
} = cc({
  source,
  symbols: {
    hello: {
      args: ["napi_env"],
      returns: "napi_value",
    },
  },
});

const result = hello();
```

And in C:

```c#hello.c
#include <node/node_api.h>

napi_value hello(napi_env env) {
  napi_value result;
  napi_create_string_utf8(env, "Hello, Napi!", NAPI_AUTO_LENGTH, &result);
  return result;
}
```

You can also use this to return other types like objects and arrays:

```c#hello.c
#include <node/node_api.h>

napi_value hello(napi_env env) {
  napi_value result;
  napi_create_object(env, &result);
  return result;
}
```

### `cc` Reference

#### `library: string[]`

The `library` array is used to specify the libraries that should be linked with the C code.

```ts
type Library = string[];

cc({
  source: "hello.c",
  library: ["sqlite3"],
});
```

#### `symbols`

The `symbols` object is used to specify the functions and variables that should be exposed to JavaScript.

```ts
type Symbols = {
  [key: string]: {
    args: FFIType[];
    returns: FFIType;
  };
};
```

#### `source`

The `source` is a file path to the C code that should be compiled and linked with the JavaScript runtime.

```ts
type Source = string | URL | BunFile;

cc({
  source: "hello.c",
  symbols: {
    hello: {
      args: [],
      returns: "int",
    },
  },
});
```

#### `flags: string | string[]`

The `flags` is an optional array of strings that should be passed to the TinyCC compiler.

```ts
type Flags = string | string[];
```

These are flags like `-I` for include directories and `-D` for preprocessor definitions.

#### `defines: Record<string, string>`

The `defines` is an optional object that should be passed to the TinyCC compiler.

```ts
type Defines = Record<string, string>;

cc({
  source: "hello.c",
  defines: {
    "NDEBUG": "1",
  },
});
```

These are preprocessor definitions passed to the TinyCC compiler.
