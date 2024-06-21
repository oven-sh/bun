There are four parts to the CI build:

- Dependencies: should be cached across builds as much as possible, it depends on git submodule hashes
- Zig Object: depends on \*.zig and src/js
- C++ Object: depends on \*.cpp and src/js
- Linking: depends on the above three

Utilizing multiple GitHub Action runners allows us to do a lot of work in parallel.

## Dependencies

```sh
BUN_DEPS_OUT_DIR="/optional/out/dir" bash ./scripts/all-dependencies.sh
```

## Zig Object

This does not have a dependency on WebKit or any of the dependencies at all. It can be compiled without checking out submodules, but you will need to have bun install run. It can be very easily cross compiled. Note that the zig object is always `bun-zig.o`.

```sh
BUN_REPO=/path/to/oven-sh/bun

cd tmp1

cmake $BUN_REPO \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCPU_TARGET="native" \
  -DZIG_TARGET="native" \
  -DBUN_ZIG_OBJ_DIR="./build"

ninja ./build/bun-zig.o
# -> bun-zig.o
```

## C++ Object

Note: if WEBKIT_DIR is not passed, it is automatically downloaded from GitHub releases. This depends on the headers from submodules but not necessarily the build copies of them, .a files, etc.

```sh
cd tmp2

cmake $BUN_REPO \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUN_CPP_ONLY=1 \

bash compile-cpp-only.sh
# -> bun-cpp-objects.a
```

## Linking

The goal is you run both stages from above on different machines, so that they can build in parallel. Zig build is slow, and MacOS build runners are slower on average than the linux ones. With both artifacts from above, you can link them together:

```sh
cd tmp3

cmake $BUN_REPO \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ_DIR="/path/to/bun-zig-dir" \
  -DBUN_CPP_ARCHIVE="/path/to/bun-cpp-objects.a"

ninja

# optional:
#   -DBUN_DEPS_OUT_DIR=... custom deps dir, use this to cache the built deps between rebuilds
#   -DWEBKIT_DIR=... same thing, but it's probably fast enough to pull from github releases

# -> bun
# -> bun-profile
# -> bun.dSYM/
```
