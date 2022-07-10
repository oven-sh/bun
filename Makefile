SHELL :=  $(shell which bash) # Use bash syntax to be consistent

OS_NAME := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH_NAME_RAW := $(shell uname -m)
BUN_AUTO_UPDATER_REPO = Jarred-Sumner/bun-releases-for-updater

# On Linux ARM64, uname -m reports aarch64
ifeq ($(ARCH_NAME_RAW),aarch64)
ARCH_NAME_RAW = arm64
endif

MARCH_NATIVE = -mtune=native

ARCH_NAME :=
DOCKER_BUILDARCH =
ifeq ($(ARCH_NAME_RAW),arm64)
	ARCH_NAME = aarch64
	DOCKER_BUILDARCH = arm64
	BREW_PREFIX_PATH = /opt/homebrew
	MIN_MACOS_VERSION ?= 11.0
	MARCH_NATIVE = -mtune=native
else
	ARCH_NAME = x64
	DOCKER_BUILDARCH = amd64
	BREW_PREFIX_PATH = /usr/local
	MIN_MACOS_VERSION ?= 10.14
	MARCH_NATIVE = -march=native -mtune=native
endif

AR=

BUN_OR_NODE = $(shell which bun || which node)

CXX_VERSION=c++2a
TRIPLET = $(OS_NAME)-$(ARCH_NAME)
PACKAGE_NAME = bun-$(TRIPLET)
PACKAGES_REALPATH = $(realpath packages)
PACKAGE_DIR = $(PACKAGES_REALPATH)/$(PACKAGE_NAME)
DEBUG_PACKAGE_DIR = $(PACKAGES_REALPATH)/debug-$(PACKAGE_NAME)
RELEASE_BUN = $(PACKAGE_DIR)/bun
DEBUG_BIN = $(DEBUG_PACKAGE_DIR)/
DEBUG_BUN = $(DEBUG_BIN)/bun-debug
BUILD_ID = $(shell cat ./build-id)
PACKAGE_JSON_VERSION = 0.1.$(BUILD_ID)
BUN_BUILD_TAG = bun-v$(PACKAGE_JSON_VERSION)
BUN_RELEASE_BIN = $(PACKAGE_DIR)/bun
PRETTIER ?= $(shell which prettier || echo "./node_modules/.bin/prettier")
DSYMUTIL ?= $(shell which dsymutil || which dsymutil-13)
WEBKIT_DIR ?= $(realpath src/bun.js/WebKit)
WEBKIT_RELEASE_DIR ?= $(WEBKIT_DIR)/WebKitBuild/Release
WEBKIT_DEBUG_DIR ?= $(WEBKIT_DIR)/WebKitBuild/Debug
WEBKIT_RELEASE_DIR_LTO ?= $(WEBKIT_DIR)/WebKitBuild/ReleaseLTO

NPM_CLIENT ?= $(shell which bun || which npm)
ZIG ?= $(shell which zig || echo -e "error: Missing zig. Please make sure zig is in PATH. Or set ZIG=/path/to-zig-executable")

# We must use the same compiler version for the JavaScriptCore bindings and JavaScriptCore
# If we don't do this, strange memory allocation failures occur.
# This is easier to happen than you'd expect.
# Using realpath here causes issues because clang uses clang++ as a symlink
# so if that's resolved, it won't build for C++
CC = $(shell which clang-13 || which clang)
CXX = $(shell which clang++-13 || which clang++)

ifeq ($(OS_NAME),darwin)
# Find LLVM
	ifeq ($(wildcard $(LLVM_PREFIX)),)
		LLVM_PREFIX = $(shell brew --prefix llvm@13)
	endif
	ifeq ($(wildcard $(LLVM_PREFIX)),)
		LLVM_PREFIX = $(shell brew --prefix llvm)
	endif
	ifeq ($(wildcard $(LLVM_PREFIX)),)
#   This is kinda ugly, but I can't find a better way to error :(
		LLVM_PREFIX = $(shell echo -e "error: Unable to find llvm. Please run 'brew install llvm@13' or set LLVM_PREFIX=/path/to/llvm")
	endif

	LDFLAGS += -L$(LLVM_PREFIX)/lib
	CPPFLAGS += -I$(LLVM_PREFIX)/include
	CC = $(LLVM_PREFIX)/bin/clang
	CXX = $(LLVM_PREFIX)/bin/clang++
	CODESIGN_IDENTITY ?= $(shell security find-identity -v -p codesigning | awk '/Apple Development/ { print $$2 }')
endif

# macOS sed is different
SED = $(shell which gsed || which sed)

BUN_DIR ?= $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
BUN_DEPS_DIR ?= $(shell pwd)/src/deps
BUN_DEPS_OUT_DIR ?= $(BUN_DEPS_DIR)
CPUS ?= $(shell nproc)
USER ?= $(echo $USER)

BUN_RELEASE_DIR ?= $(shell pwd)/../bun-release

OPENSSL_VERSION = OpenSSL_1_1_1l
LIBICONV_PATH ?= $(BREW_PREFIX_PATH)/opt/libiconv/lib/libiconv.a

OPENSSL_LINUX_DIR = $(BUN_DEPS_DIR)/openssl/openssl-OpenSSL_1_1_1l

CMAKE_FLAGS_WITHOUT_RELEASE = -DCMAKE_C_COMPILER=$(CC) -DCMAKE_CXX_COMPILER=$(CXX) -DCMAKE_OSX_DEPLOYMENT_TARGET=$(MIN_MACOS_VERSION)
CMAKE_FLAGS = $(CMAKE_FLAGS_WITHOUT_RELEASE) -DCMAKE_BUILD_TYPE=Release

# SQLite3 is dynamically linked on macOS
# it is about 30% faster to use system SQLite3 on macOS (something something kernel page cache)
# on Linux, it is statically linked
SQLITE_OBJECT =


BITCODE_OR_SECTIONS=-fdata-sections -ffunction-sections
EMBED_OR_EMIT_BITCODE=
LIBTOOL=libtoolize
ifeq ($(OS_NAME),darwin)
LIBTOOL=glibtoolize
AR=$(LLVM_PREFIX)/bin/llvm-ar
BITCODE_OR_SECTIONS=-fembed-bitcode
endif

ifeq ($(OS_NAME),linux)
LIBICONV_PATH =
AR=llvm-ar-13
endif

OPTIMIZATION_LEVEL=-O3 $(MARCH_NATIVE)
CFLAGS = $(MACOS_MIN_FLAG) $(MARCH_NATIVE) $(BITCODE_OR_SECTIONS) $(OPTIMIZATION_LEVEL) -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden
BUN_CFLAGS = $(MACOS_MIN_FLAG) $(MARCH_NATIVE) $(EMBED_OR_EMIT_BITCODE) $(OPTIMIZATION_LEVEL) -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden
BUN_TMP_DIR := /tmp/make-bun
BUN_DEPLOY_DIR = /tmp/bun-v$(PACKAGE_JSON_VERSION)/$(PACKAGE_NAME)


DEFAULT_USE_BMALLOC := 1


USE_BMALLOC ?= DEFAULT_USE_BMALLOC

JSC_BASE_DIR ?= ${HOME}/webkit-build

DEFAULT_JSC_LIB :=
DEFAULT_JSC_LIB_DEBUG :=

ifeq ($(OS_NAME),linux)
DEFAULT_JSC_LIB = $(JSC_BASE_DIR)/lib
DEFAULT_JSC_LIB_DEBUG = $(DEFAULT_JSC_LIB)
endif

ifeq ($(OS_NAME),darwin)
DEFAULT_JSC_LIB = $(WEBKIT_RELEASE_DIR_LTO)/lib
DEFAULT_JSC_LIB_DEBUG = $(WEBKIT_RELEASE_DIR)/lib
endif

JSC_LIB ?= $(DEFAULT_JSC_LIB)
JSC_LIB_DEBUG ?= $(DEFAULT_JSC_LIB_DEBUG)

JSC_INCLUDE_DIR ?= $(JSC_BASE_DIR)/include
ZLIB_INCLUDE_DIR ?= $(BUN_DEPS_DIR)/zlib
ZLIB_LIB_DIR ?= $(BUN_DEPS_DIR)/zlib

JSC_FILES := $(JSC_LIB)/libJavaScriptCore.a $(JSC_LIB)/libWTF.a  $(JSC_LIB)/libbmalloc.a $(JSC_LIB)/libLowLevelInterpreterLib.a
JSC_FILES_DEBUG := $(JSC_LIB_DEBUG)/libJavaScriptCore.a $(JSC_LIB_DEBUG)/libWTF.a  $(JSC_LIB_DEBUG)/libbmalloc.a $(JSC_LIB_DEBUG)/libLowLevelInterpreterLib.a


ENABLE_MIMALLOC ?= 1

# https://github.com/microsoft/mimalloc/issues/512
# Linking mimalloc via object file on macOS x64 can cause heap corruption
_MIMALLOC_FILE = libmimalloc.o
_MIMALLOC_INPUT_PATH = CMakeFiles/mimalloc-obj.dir/src/static.c.o
_MIMALLOC_DEBUG_FILE = libmimalloc-debug.a
_MIMALLOC_OBJECT_FILE = 1
_MIMALLOC_LINK = $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)
DEFAULT_LINKER_FLAGS =

JSC_BUILD_STEPS :=
ifeq ($(OS_NAME),linux)
	JSC_BUILD_STEPS += jsc-build-linux
	_MIMALLOC_LINK = $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)
DEFAULT_LINKER_FLAGS= -pthread -ldl
endif
ifeq ($(OS_NAME),darwin)
    _MIMALLOC_OBJECT_FILE = 0
	JSC_BUILD_STEPS += jsc-build-mac jsc-copy-headers
	_MIMALLOC_FILE = libmimalloc.a
	_MIMALLOC_INPUT_PATH = libmimalloc.a
	_MIMALLOC_LINK = -lmimalloc
endif

MIMALLOC_FILE=
MIMALLOC_INPUT_PATH=
ifeq ($(ENABLE_MIMALLOC), 1)
MIMALLOC_FILE=$(_MIMALLOC_FILE)
MIMALLOC_INPUT_PATH=$(_MIMALLOC_INPUT_PATH)
endif





MACOSX_DEPLOYMENT_TARGET=$(MIN_MACOS_VERSION)
MACOS_MIN_FLAG=

POSIX_PKG_MANAGER=sudo apt

STRIP=

ifeq ($(OS_NAME),darwin)
STRIP=/usr/bin/strip
endif

ifeq ($(OS_NAME),linux)
STRIP=$(which llvm-strip || which llvm-strip-13 || echo "Missing strip")
endif


HOMEBREW_PREFIX ?= $(BREW_PREFIX_PATH)


SRC_DIR := src/bun.js/bindings
OBJ_DIR := src/bun.js/bindings-obj
SRC_PATH := $(realpath $(SRC_DIR))
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
SRC_WEBCORE_FILES := $(wildcard $(SRC_DIR)/webcore/*.cpp)
SRC_SQLITE_FILES := $(wildcard $(SRC_DIR)/sqlite/*.cpp)
SRC_BUILTINS_FILES := $(wildcard  src/bun.js/builtins/*.cpp)
OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
WEBCORE_OBJ_FILES := $(patsubst $(SRC_DIR)/webcore/%.cpp,$(OBJ_DIR)/%.o,$(SRC_WEBCORE_FILES))
SQLITE_OBJ_FILES := $(patsubst $(SRC_DIR)/sqlite/%.cpp,$(OBJ_DIR)/%.o,$(SRC_SQLITE_FILES))
BUILTINS_OBJ_FILES := $(patsubst src/bun.js/builtins/%.cpp,$(OBJ_DIR)/%.o,$(SRC_BUILTINS_FILES))
BINDINGS_OBJ := $(OBJ_FILES) $(WEBCORE_OBJ_FILES) $(SQLITE_OBJ_FILES) $(BUILTINS_OBJ_FILES)
MAC_INCLUDE_DIRS := -I$(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders \
		-I$(WEBKIT_RELEASE_DIR)/WTF/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ICU/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ \
		-Isrc/bun.js/bindings/ \
		-Isrc/bun.js/builtins/ \
		-Isrc/bun.js/bindings/webcore \
		-Isrc/bun.js/bindings/sqlite \
		-Isrc/bun.js/builtins/cpp \
		-I$(WEBKIT_DIR)/Source/bmalloc  \
		-I$(WEBKIT_DIR)/Source

LINUX_INCLUDE_DIRS := -I$(JSC_INCLUDE_DIR) \
						-Isrc/bun.js/builtins/ \
					  -Isrc/bun.js/bindings/ \
					  -Isrc/bun.js/bindings/webcore \
					  -Isrc/bun.js/bindings/sqlite \
					  -Isrc/bun.js/builtins/cpp \
					  -I$(ZLIB_INCLUDE_DIR)


UWS_INCLUDE_DIR := -I$(BUN_DEPS_DIR)/uws/uSockets/src -I$(BUN_DEPS_DIR)/uws/src -I$(BUN_DEPS_DIR)


INCLUDE_DIRS := $(UWS_INCLUDE_DIR) -I$(BUN_DEPS_DIR)/mimalloc/include -Isrc/napi


ifeq ($(OS_NAME),linux)
	INCLUDE_DIRS += $(LINUX_INCLUDE_DIRS)
	SQLITE_OBJECT = $(realpath $(BUN_DEPS_OUT_DIR))/sqlite3.o
endif

ifeq ($(OS_NAME),darwin)
MACOS_MIN_FLAG=-mmacosx-version-min=$(MIN_MACOS_VERSION)
POSIX_PKG_MANAGER=brew
INCLUDE_DIRS += $(MAC_INCLUDE_DIRS)
endif



MACOS_ICU_FILES = $(HOMEBREW_PREFIX)/opt/icu4c/lib/libicudata.a \
	$(HOMEBREW_PREFIX)/opt/icu4c/lib/libicui18n.a \
	$(HOMEBREW_PREFIX)/opt/icu4c/lib/libicuuc.a

MACOS_ICU_INCLUDE = $(HOMEBREW_PREFIX)/opt/icu4c/include

ICU_FLAGS ?=

# TODO: find a way to make this more resilient
# Ideally, we could just look up the linker search paths
LIB_ICU_PATH ?= $(BUN_DEPS_DIR)

ifeq ($(OS_NAME),linux)
	ICU_FLAGS += $(LIB_ICU_PATH)/libicuuc.a $(LIB_ICU_PATH)/libicudata.a $(LIB_ICU_PATH)/libicui18n.a
endif

ifeq ($(OS_NAME),darwin)
ICU_FLAGS += -l icucore \
	$(MACOS_ICU_FILES) \
	-I$(MACOS_ICU_INCLUDE)
endif


BORINGSSL_PACKAGE = --pkg-begin boringssl $(BUN_DEPS_DIR)/boringssl.zig --pkg-end

CLANG_FLAGS = $(INCLUDE_DIRS) \
		-std=$(CXX_VERSION) \
		-DSTATICALLY_LINKED_WITH_JavaScriptCore=1 \
		-DSTATICALLY_LINKED_WITH_WTF=1 \
		-DSTATICALLY_LINKED_WITH_BMALLOC=1 \
		-DBUILDING_WITH_CMAKE=1 \
		-DBUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1 \
		-DNDEBUG=1 \
		-DNOMINMAX \
		-DIS_BUILD \
		-DENABLE_INSPECTOR_ALTERNATE_DISPATCHERS=1 \
		-DBUILDING_JSCONLY__ \
		-DASSERT_ENABLED=0 \
		-fvisibility=hidden \
		-fvisibility-inlines-hidden

PLATFORM_LINKER_FLAGS =

SYMBOLS=

# This flag is only added to webkit builds on Apple platforms
# It has something to do with ICU
ifeq ($(OS_NAME), darwin)
SYMBOLS=-exported_symbols_list $(realpath src/symbols.txt)
PLATFORM_LINKER_FLAGS += -DDU_DISABLE_RENAMING=1 \
		-lstdc++ \
		-fno-keep-static-consts
endif

ifeq ($(OS_NAME),linux)
SYMBOLS=-Wl,--dynamic-list $(realpath src/symbols.dyn)
endif

SHARED_LIB_EXTENSION = .so

JSC_BINDINGS = $(BINDINGS_OBJ) $(JSC_FILES)
JSC_BINDINGS_DEBUG = $(BINDINGS_OBJ) $(JSC_FILES_DEBUG)

RELEASE_FLAGS=
DEBUG_FLAGS=

ifeq ($(OS_NAME), darwin)
	RELEASE_FLAGS += -Wl,-dead_strip -Wl,-dead_strip_dylibs
	DEBUG_FLAGS += -Wl,-dead_strip -Wl,-dead_strip_dylibs
	SHARED_LIB_EXTENSION = .dylib
endif

ARCHIVE_FILES_WITHOUT_LIBCRYPTO = \
		$(BUN_DEPS_OUT_DIR)/picohttpparser.o \
		-L$(BUN_DEPS_OUT_DIR) \
		-llolhtml \
		-lz \
		-larchive \
		-lssl \
		-lbase64 \
		-ltcc \
		$(_MIMALLOC_LINK)

ARCHIVE_FILES = $(ARCHIVE_FILES_WITHOUT_LIBCRYPTO) -lcrypto

ifeq ($(OS_NAME), darwin)
	ARCHIVE_FILES += $(wildcard $(BUN_DEPS_DIR)/uws/uSockets/*.bc) $(BUN_DEPS_OUT_DIR)/libuwsockets.o
else
	ARCHIVE_FILES += -lusockets $(BUN_DEPS_OUT_DIR)/libuwsockets.o
endif

STATIC_MUSL_FLAG ?=

ifeq ($(OS_NAME), linux)
PLATFORM_LINKER_FLAGS = $(BUN_CFLAGS) \
		-fuse-ld=lld \
		-Wl,-z,now \
		-Wl,--as-needed \
		-Wl,--gc-sections \
		-Wl,-z,stack-size=12800000 \
		-static-libstdc++ \
		-static-libgcc \
		-fno-omit-frame-pointer \
		-Wl,--compress-debug-sections,zlib \
		${STATIC_MUSL_FLAG}  \
		-Wl,-Bsymbolic-functions \
		-fno-semantic-interposition \
		-flto \
		-Wl,--allow-multiple-definition \
		-rdynamic

ARCHIVE_FILES_WITHOUT_LIBCRYPTO += $(BUN_DEPS_OUT_DIR)/libbacktrace.a
endif


BUN_LLD_FLAGS_WITHOUT_JSC = $(ARCHIVE_FILES) \
		$(LIBICONV_PATH) \
		$(CLANG_FLAGS) \
		$(DEFAULT_LINKER_FLAGS) \
		$(PLATFORM_LINKER_FLAGS) \
		$(SQLITE_OBJECT) ${ICU_FLAGS}



BUN_LLD_FLAGS = $(BUN_LLD_FLAGS_WITHOUT_JSC)  $(JSC_FILES) $(BINDINGS_OBJ)
BUN_LLD_FLAGS_FAST = $(BUN_LLD_FLAGS_WITHOUT_JSC)  $(JSC_FILES_DEBUG) $(BINDINGS_OBJ)

BUN_LLD_FLAGS_DEBUG = $(BUN_LLD_FLAGS_WITHOUT_JSC) $(JSC_FILES_DEBUG) $(BINDINGS_OBJ)

CLANG_VERSION = $(shell $(CC) --version | awk '/version/ {for(i=1; i<=NF; i++){if($$i=="version"){split($$(i+1),v,".");print v[1]}}}')


bun:

base64:
	cd src/base64 && \
		rm -rf src/base64/*.{o,ll,bc} && \
	   $(CC) $(EMIT_LLVM_FOR_RELEASE) $(BUN_CFLAGS) $(OPTIMIZATION_LEVEL) -g -fPIC -c *.c -I$(SRC_DIR)/base64  && \
	   $(CXX) $(EMIT_LLVM_FOR_RELEASE) $(CXXFLAGS) $(BUN_CFLAGS) -c neonbase64.cc -g -fPIC  && \
	   $(AR) rcvs $(BUN_DEPS_OUT_DIR)/libbase64.a ./*.o

# Prevent dependency on libtcc1 so it doesn't do filesystem lookups
TINYCC_CFLAGS= -DTCC_LIBTCC1=\"\0\"

tinycc:
	cd $(TINYCC_DIR) && \
		make clean && \
		AR=$(AR) CC=$(CC) CFLAGS='$(CFLAGS) $(TINYCC_CFLAGS)' ./configure --enable-static --cc=$(CC) --ar=$(AR) --config-predefs=yes  && \
		make -j10 && \
		cp $(TINYCC_DIR)/*.a $(BUN_DEPS_OUT_DIR)

generate-builtins:
	rm -f src/bun.js/bindings/*Builtin*.cpp src/bun.js/bindings/*Builtin*.h src/bun.js/bindings/*Builtin*.cpp
	rm -rf src/bun.js/builtins/cpp
	mkdir -p src/bun.js/builtins/cpp
	$(shell which python || which python2) $(realpath $(WEBKIT_DIR)/Source/JavaScriptCore/Scripts/generate-js-builtins.py) -i $(realpath src)/bun.js/builtins/js  -o $(realpath src)/bun.js/builtins/cpp --framework WebCore --force
	$(shell which python || which python2) $(realpath $(WEBKIT_DIR)/Source/JavaScriptCore/Scripts/generate-js-builtins.py) -i $(realpath src)/bun.js/builtins/js  -o $(realpath src)/bun.js/builtins/cpp --framework WebCore --wrappers-only
	rm -rf /tmp/1.h src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h.1
	echo -e '// clang-format off\nnamespace Zig { class GlobalObject; }' >> /tmp/1.h
	cat /tmp/1.h  src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h > src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h.1
	mv src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h.1 src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h
	$(SED) -i -e 's/class JSDOMGlobalObject/using JSDOMGlobalObject = Zig::GlobalObject/' src/bun.js/builtins/cpp/WebCoreJSBuiltinInternals.h
	# this is the one we actually build
	mv src/bun.js/builtins/cpp/*JSBuiltin*.cpp src/bun.js/builtins

vendor-without-check: api analytics node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib boringssl libarchive libbacktrace lolhtml usockets uws base64 tinycc

prepare-types:
	BUN_VERSION=$(PACKAGE_JSON_VERSION) $(BUN_RELEASE_BIN) types/bun/bundle.ts packages/bun-types
	echo "Generated types for $(PACKAGE_JSON_VERSION) in packages/bun-types"
	cp packages/bun-types/types.d.ts /tmp/bun-types.d.ts
	cd /tmp && tsc /tmp/bun-types.d.ts

release-types:
	# can be removed when/if "bun publish" is implemented
	@npm --version >/dev/null 2>&1 || (echo -e "ERROR: npm is required."; exit 1)
	cd packages/bun-types && npm publish

format:
	$(PRETTIER) --write test/bun.js/*.js
	$(PRETTIER) --write test/bun.js/solid-dom-fixtures/**/*.js

lolhtml:
	cd $(BUN_DEPS_DIR)/lol-html/ && cd $(BUN_DEPS_DIR)/lol-html/c-api && cargo build --release && cp target/release/liblolhtml.a $(BUN_DEPS_OUT_DIR)

boringssl-build:
	cd $(BUN_DEPS_DIR)/boringssl && mkdir -p build && cd build && CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) -GNinja .. && ninja

boringssl-build-debug:
	cd $(BUN_DEPS_DIR)/boringssl && mkdir -p build && cd build && CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS_WITHOUT_RELEASE) -GNinja .. && ninja

boringssl-copy:
	cp $(BUN_DEPS_DIR)/boringssl/build/ssl/libssl.a $(BUN_DEPS_OUT_DIR)/libssl.a
	cp $(BUN_DEPS_DIR)/boringssl/build/crypto/libcrypto.a $(BUN_DEPS_OUT_DIR)/libcrypto.a

boringssl: boringssl-build boringssl-copy
boringssl-debug: boringssl-build-debug boringssl-copy

compile-ffi-test:
	clang $(OPTIMIZATION_LEVEL) -shared -undefined dynamic_lookup -o /tmp/bun-ffi-test.dylib -fPIC ./test/bun.js/ffi-test.c

libbacktrace:
	cd $(BUN_DEPS_DIR)/libbacktrace && \
	CFLAGS="$(CFLAGS)" CC=$(CC) ./configure --disable-shared --enable-static  --with-pic && \
	make -j$(CPUS) && \
	cp ./.libs/libbacktrace.a $(BUN_DEPS_OUT_DIR)/libbacktrace.a


sqlite:


libarchive:
	cd $(BUN_DEPS_DIR)/libarchive; \
	(make clean || echo ""); \
	(./build/clean.sh || echo ""); \
	./build/autogen.sh; \
	CFLAGS="$(CFLAGS)" CC=$(CC) ./configure --disable-shared --enable-static  --with-pic  --disable-bsdtar   --disable-bsdcat --disable-rpath --enable-posix-regex-lib  --without-xml2  --without-expat --without-openssl  --without-iconv --without-zlib; \
	make -j${CPUS}; \
	cp ./.libs/libarchive.a $(BUN_DEPS_OUT_DIR)/libarchive.a;

tgz:
	$(ZIG) build tgz-obj -Drelease-fast
	$(CXX) $(PACKAGE_DIR)/tgz.o -g -o ./misctools/tgz $(DEFAULT_LINKER_FLAGS) -lc  $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/tgz.o

tgz-debug:
	$(ZIG) build tgz-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/tgz.o -g -o ./misctools/tgz $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(DEBUG_PACKAGE_DIR)/tgz.o

vendor: require init-submodules vendor-without-check

zlib:
	cd $(BUN_DEPS_DIR)/zlib; CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) .; CFLAGS="$(CFLAGS)" make;
	cp $(BUN_DEPS_DIR)/zlib/libz.a $(BUN_DEPS_OUT_DIR)/libz.a

docker-login:
	docker login ghcr.io --username jarred@jarredsumner.com

docker-push-base:
	BUILDKIT=1 docker build -f Dockerfile.base --build-arg GITHUB_WORKSPACE=/build --platform=linux/$(DOCKER_BUILDARCH) --tag bun-base --target base .
	BUILDKIT=1 docker build -f Dockerfile.base --build-arg GITHUB_WORKSPACE=/build --platform=linux/$(DOCKER_BUILDARCH) --tag bun-base-with-zig-and-webkit --target base-with-zig-and-webkit .
	BUILDKIT=1 docker build -f Dockerfile.base --build-arg GITHUB_WORKSPACE=/build --platform=linux/$(DOCKER_BUILDARCH) --tag bun-base-with-args --target base-with-args .

	docker tag bun-base ghcr.io/jarred-sumner/bun-base:latest
	docker push ghcr.io/jarred-sumner/bun-base:latest

	docker tag bun-base-with-zig-and-webkit ghcr.io/jarred-sumner/bun-base-with-zig-and-webkit:latest
	docker push ghcr.io/jarred-sumner/bun-base-with-zig-and-webkit:latest

	docker tag bun-base-with-args ghcr.io/jarred-sumner/bun-base-with-args:latest
	docker push ghcr.io/jarred-sumner/bun-base-with-args:latest

require:
	@echo "Checking if the required utilities are available..."
	@if [ $(CLANG_VERSION) -lt "13" ]; then echo -e "ERROR: clang version >=13 required, found: $(CLANG_VERSION). Install with:\n\n    $(POSIX_PKG_MANAGER) install llvm@13"; exit 1; fi
	@cmake --version >/dev/null 2>&1 || (echo -e "ERROR: cmake is required."; exit 1)
	@esbuild --version >/dev/null 2>&1 || (echo -e "ERROR: esbuild is required."; exit 1)
	@$(NPM_CLIENT) --version >/dev/null 2>&1 || (echo -e "ERROR: NPM client (bun or npm) is required."; exit 1)
	@go version >/dev/null 2>&1 || (echo -e "ERROR: go is required."; exit 1)
	@which aclocal > /dev/null || (echo -e  "ERROR: automake is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install automake"; exit 1)
	@which $(LIBTOOL) > /dev/null || (echo -e "ERROR: libtool is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install libtool"; exit 1)
	@which ninja > /dev/null || (echo -e "ERROR: Ninja is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install ninja"; exit 1)
	@echo "You have the dependencies installed! Woo"

init-submodules:
	git submodule update --init --recursive --progress --depth=1

build-obj:
	$(ZIG) build obj -Drelease-fast

dev-build-obj-wasm:
	$(ZIG) build bun-wasm -Dtarget=wasm32-freestanding --prominent-compile-errors

dev-wasm: dev-build-obj-wasm
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init']" \
		-g -s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/libmimalloc.a.wasm  \
		packages/debug-bun-freestanding-wasm32/bun-wasm.o $(OPTIMIZATION_LEVEL) --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/debug-bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/debug-bun-freestanding-wasm32/bun-wasm.wasm src/api/demo/public/bun-wasm.wasm

build-obj-wasm:
	$(ZIG) build bun-wasm -Drelease-fast -Dtarget=wasm32-freestanding --prominent-compile-errors
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init']" \
		-g -s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/libmimalloc.a.wasm  \
		packages/bun-freestanding-wasm32/bun-wasm.o $(OPTIMIZATION_LEVEL) --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/bun-freestanding-wasm32/bun-wasm.wasm src/api/demo/public/bun-wasm.wasm

build-obj-wasm-small:
	$(ZIG) build bun-wasm -Drelease-small -Dtarget=wasm32-freestanding --prominent-compile-errors
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init']" \
		-g -s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/libmimalloc.a.wasm  \
		packages/bun-freestanding-wasm32/bun-wasm.o -Oz --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/bun-freestanding-wasm32/bun-wasm.wasm src/api/demo/public/bun-wasm.wasm

wasm: api build-obj-wasm-small
	@rm -rf packages/bun-wasm/*.{d.ts,js,wasm,cjs,mjs,tsbuildinfo}
	@cp packages/bun-freestanding-wasm32/bun-wasm.wasm packages/bun-wasm/bun.wasm
	@cp src/api/schema.d.ts packages/bun-wasm/schema.d.ts
	@cp src/api/schema.js packages/bun-wasm/schema.js
	@cd packages/bun-wasm && $(NPM_CLIENT) run tsc -- -p .
	@esbuild --sourcemap=external --external:fs --define:process.env.NODE_ENV='"production"' --outdir=packages/bun-wasm --target=esnext --bundle packages/bun-wasm/index.ts --format=esm --minify 2> /dev/null
	@mv packages/bun-wasm/index.js packages/bun-wasm/index.mjs
	@mv packages/bun-wasm/index.js.map packages/bun-wasm/index.mjs.map
	@esbuild --sourcemap=external --external:fs --define:process.env.NODE_ENV='"production"' --outdir=packages/bun-wasm --target=esnext --bundle packages/bun-wasm/index.ts --format=cjs --minify --platform=node 2> /dev/null
	@mv packages/bun-wasm/index.js packages/bun-wasm/index.cjs
	@mv packages/bun-wasm/index.js.map packages/bun-wasm/index.cjs.map
	@rm -rf packages/bun-wasm/*.tsbuildinfo
	@wasm-opt -O4 --enable-mutable-globals  packages/bun-wasm/bun.wasm -o /tmp/bun.wasm
	@mv /tmp/bun.wasm packages/bun-wasm/bun.wasm

build-obj-safe:
	$(ZIG) build obj -Drelease-safe

UWS_CC_FLAGS = -pthread  -DLIBUS_USE_OPENSSL=1 -DUWS_HTTPRESPONSE_NO_WRITEMARK=1  -DLIBUS_USE_BORINGSSL=1 -DWITH_BORINGSSL=1 -Wpedantic -Wall -Wextra -Wsign-conversion -Wconversion $(UWS_INCLUDE) -DUWS_WITH_PROXY
UWS_CXX_FLAGS = $(UWS_CC_FLAGS) -std=$(CXX_VERSION) -fno-exceptions
UWS_LDFLAGS = -I$(BUN_DEPS_DIR)/boringssl/include -I$(ZLIB_INCLUDE_DIR)
USOCKETS_DIR = $(BUN_DEPS_DIR)/uws/uSockets/
USOCKETS_SRC_DIR = $(BUN_DEPS_DIR)/uws/uSockets/src/

usockets:
	rm -rf $(BUN_DEPS_DIR)/uws/uSockets/*.o $(BUN_DEPS_DIR)/uws/uSockets/**/*.o $(BUN_DEPS_DIR)/uws/uSockets/*.a $(BUN_DEPS_DIR)/uws/uSockets/*.bc
	cd $(USOCKETS_DIR) && $(CC) -fno-builtin-malloc -fno-builtin-free -fno-builtin-realloc $(EMIT_LLVM_FOR_RELEASE)  $(MACOS_MIN_FLAG) -fPIC $(CFLAGS) $(UWS_CC_FLAGS) -save-temps -I$(BUN_DEPS_DIR)/uws/uSockets/src $(UWS_LDFLAGS) -g $(DEFAULT_LINKER_FLAGS) $(PLATFORM_LINKER_FLAGS) $(OPTIMIZATION_LEVEL) -g -c $(wildcard $(USOCKETS_SRC_DIR)/*.c) $(wildcard $(USOCKETS_SRC_DIR)/**/*.c)
	cd $(USOCKETS_DIR) && $(CXX) -fno-builtin-malloc -fno-builtin-free -fno-builtin-realloc $(EMIT_LLVM_FOR_RELEASE) $(MACOS_MIN_FLAG)  -fPIC $(CXXFLAGS) $(UWS_CXX_FLAGS) -save-temps -I$(BUN_DEPS_DIR)/uws/uSockets/src $(UWS_LDFLAGS) -g $(DEFAULT_LINKER_FLAGS) $(PLATFORM_LINKER_FLAGS) $(OPTIMIZATION_LEVEL) -g -c $(wildcard $(USOCKETS_SRC_DIR)/*.cpp) $(wildcard $(USOCKETS_SRC_DIR)/**/*.cpp)
	cd $(USOCKETS_DIR) && $(AR) rcvs $(BUN_DEPS_OUT_DIR)/libusockets.a *.bc
uws: usockets
	$(CXX) $(BITCODE_OR_SECTIONS) $(EMIT_LLVM_FOR_RELEASE) -fPIC -I$(BUN_DEPS_DIR)/uws/uSockets/src $(CLANG_FLAGS) $(CFLAGS) $(UWS_CXX_FLAGS) $(UWS_LDFLAGS) $(PLATFORM_LINKER_FLAGS) -c -I$(BUN_DEPS_DIR) $(BUN_DEPS_OUT_DIR)/libusockets.a $(BUN_DEPS_DIR)/libuwsockets.cpp -o $(BUN_DEPS_OUT_DIR)/libuwsockets.o

sign-macos-x64:
	gon sign.macos-x64.json

sign-macos-aarch64:
	gon sign.macos-aarch64.json

cls:
	@echo "\n\n---\n\n"

release: all-js jsc-bindings-mac build-obj cls bun-link-lld-release bun-link-lld-release-dsym release-bin-entitlements
release-safe: all-js jsc-bindings-mac build-obj-safe cls bun-link-lld-release bun-link-lld-release-dsym release-bin-entitlements

jsc-check:
	@ls $(JSC_BASE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit build. Please compile the WebKit submodule using the Dockerfile at $(shell pwd)/src/javascript/WebKit/Dockerfile and then copy from /output in the Docker container to $(JSC_BASE_DIR). You can override the directory via JSC_BASE_DIR. \n\n 	DOCKER_BUILDKIT=1 docker build -t bun-webkit $(shell pwd)/src/bun.js/WebKit -f $(shell pwd)/src/bun.js/WebKit/Dockerfile --progress=plain\n\n 	docker container create bun-webkit\n\n 	# Get the container ID\n	docker container ls\n\n 	docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $(JSC_BASE_DIR)" && exit 1)
	@ls $(JSC_INCLUDE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit include directory at $(JSC_INCLUDE_DIR)." && exit 1)
	@ls $(JSC_LIB)  >/dev/null 2>&1 || (echo "Failed to access WebKit lib directory at $(JSC_LIB)." && exit 1)

all-js: runtime_js fallback_decoder bun_error node-fallbacks

fmt-cpp:
	cd src/bun.js/bindings && clang-format *.cpp *.h -i

fmt-zig:
	cd src && zig fmt **/*.zig

fmt: fmt-cpp fmt-zig

api:
	$(NPM_CLIENT) install
	./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig
	$(ZIG) fmt src/api/schema.zig
	$(PRETTIER) --write src/api/schema.js
	$(PRETTIER) --write src/api/schema.d.ts

node-fallbacks:
	@cd src/node-fallbacks; $(NPM_CLIENT) install; $(NPM_CLIENT) run --silent build

fallback_decoder:
	@esbuild --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

runtime_js:
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index-with-refresh.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.refresh.js; cat src/runtime.footer.with-refresh.js >> src/runtime.out.refresh.js
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.node.pre.out.js; cat src/runtime.node.pre.out.js src/runtime.footer.node.js > src/runtime.node.out.js
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.bun.pre.out.js; cat src/runtime.bun.pre.out.js src/runtime.footer.bun.js > src/runtime.bun.out.js

runtime_js_dev:
	@NODE_ENV=development esbuild --define:process.env.NODE_ENV="development" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js
	@NODE_ENV=development esbuild --define:process.env.NODE_ENV="development" --target=esnext  --bundle src/runtime/index-with-refresh.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --external:/bun:* > src/runtime.out.refresh.js; cat src/runtime.footer.with-refresh.js >> src/runtime.out.refresh.js
	@NODE_ENV=development esbuild --define:process.env.NODE_ENV="development" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --external:/bun:* > src/runtime.node.pre.out.js; cat src/runtime.node.pre.out.js src/runtime.footer.node.js > src/runtime.node.out.js
	@NODE_ENV=development esbuild --define:process.env.NODE_ENV="development" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --external:/bun:* > src/runtime.bun.pre.out.js; cat src/runtime.bun.pre.out.js src/runtime.footer.bun.js > src/runtime.bun.out.js

bun_error:
	@cd packages/bun-error; $(NPM_CLIENT) install; $(NPM_CLIENT) run --silent build

generate-install-script:
	@rm -f $(PACKAGES_REALPATH)/bun/install.js
	@esbuild --log-level=error --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" --define:process.env.NODE_ENV="\"production\"" --platform=node  --format=cjs $(PACKAGES_REALPATH)/bun/install.ts > $(PACKAGES_REALPATH)/bun/install.js

fetch:
	$(ZIG) build -Drelease-fast fetch-obj
	$(CXX) $(PACKAGE_DIR)/fetch.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/fetch.o

sha:
	$(ZIG) build -Drelease-fast sha-bench-obj
	$(CXX) $(PACKAGE_DIR)/sha.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/sha $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/sha.o

fetch-debug:
	$(ZIG) build fetch-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/fetch.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)


httpbench-debug:
	$(ZIG) build httpbench-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/httpbench.o -g -o ./misctools/http_bench $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)


httpbench-release:
	$(ZIG) build -Drelease-fast httpbench-obj
	$(CXX) $(PACKAGE_DIR)/httpbench.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/http_bench $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/httpbench.o




check-glibc-version-dependency:
	@objdump -T $(RELEASE_BUN) | ((grep -qe "GLIBC_2.3[0-9]") && { echo "Glibc 2.3X detected, this will break the binary"; exit 1; }) || true

ifeq ($(OS_NAME),darwin)



# Hardened runtime will not work with debugging
bun-codesign-debug:
	codesign --entitlements $(realpath entitlements.plist) --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(DEBUG_BUN)

bun-codesign-release-local:
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(RELEASE_BUN)
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(PACKAGE_DIR)/bun-profile

bun-codesign-release-local-debug:
	codesign --entitlements $(realpath entitlements.debug.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(RELEASE_BUN)
	codesign --entitlements $(realpath entitlements.debug.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(PACKAGE_DIR)/bun-profile


endif

bun-codesign-debug:
bun-codesign-release-local:
bun-codesign-release-local-debug:



jsc: jsc-build jsc-copy-headers jsc-bindings
jsc-build: $(JSC_BUILD_STEPS)
jsc-bindings: jsc-bindings-headers jsc-bindings-mac

clone-submodules:
	git -c submodule."src/bun.js/WebKit".update=none submodule update --init --recursive --depth=1 --progress

devcontainer: clone-submodules mimalloc zlib libarchive boringssl picohttp identifier-cache node-fallbacks jsc-bindings-headers api analytics bun_error fallback_decoder jsc-bindings-mac dev runtime_js_dev libarchive libbacktrace lolhtml usockets uws base64 tinycc

CLANG_FORMAT := $(shell command -v clang-format 2> /dev/null)


jsc-bindings-headers:
	rm -f /tmp/build-jsc-headers src/bun.js/bindings/headers.zig
	touch src/bun.js/bindings/headers.zig
	mkdir -p src/bun.js/bindings-obj/
	$(ZIG) build headers-obj
	$(CXX) $(PLATFORM_LINKER_FLAGS) $(JSC_FILES_DEBUG) ${ICU_FLAGS} $(BUN_LLD_FLAGS_WITHOUT_JSC)  -g $(DEBUG_BIN)/headers.o -W -o /tmp/build-jsc-headers -lc;
	/tmp/build-jsc-headers
	$(ZIG) translate-c src/bun.js/bindings/headers.h > src/bun.js/bindings/headers.zig
	$(BUN_OR_NODE) misctools/headers-cleaner.js
	$(ZIG) fmt src/bun.js/bindings/headers.zig


MIMALLOC_OVERRIDE_FLAG ?=


bump:
	expr 0.1.0 + 1 > build-id


identifier-cache:
	$(ZIG) run src/js_lexer/identifier_data.zig

tag:
	git tag $(BUN_BUILD_TAG)
	git push --tags
	cd ../bun-releases-for-updater && echo $(BUN_BUILD_TAG) > bumper && git add bumper && git commit -m "Update latest release" && git tag $(BUN_BUILD_TAG) && git push

prepare-release: tag release-create

release-create-auto-updater:

release-create:
	gh release create --title "bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)"
	gh release create --repo=$(BUN_AUTO_UPDATER_REPO) --title "bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)" -n "See https://github.com/Jarred-Sumner/bun/releases/tag/$(BUN_BUILD_TAG) for release notes. Using the install script or bun upgrade is the recommended way to install bun. Join bun's Discord to get access https://bun.sh/discord"

release-bin-entitlements:

release-bin-generate-zip:
release-bin-codesign:

ifeq ($(OS_NAME),darwin)
# Without this, JIT will fail on aarch64
# strip will remove the entitlements.plist
# which, in turn, will break JIT
release-bin-entitlements:
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(PACKAGE_DIR)/bun
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(PACKAGE_DIR)/bun-profile


# macOS expects a specific directory structure for the zip file
# ditto lets us generate it similarly to right clicking "Compress" in Finder
release-bin-generate-zip:
	dot_clean -vnm  /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET)
	cd /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET) && \
		codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict bun
	ditto -ck --rsrc --sequesterRsrc --keepParent /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET) $(BUN_DEPLOY_ZIP)

release-bin-codesign:
	xcrun notarytool submit --wait $(BUN_DEPLOY_ZIP) --keychain-profile "bun"

else

release-bin-generate-zip:
	cd /tmp/bun-$(PACKAGE_JSON_VERSION)/ && zip -r bun-$(TRIPLET).zip bun-$(TRIPLET)


endif


BUN_DEPLOY_ZIP = /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET).zip
BUN_DEPLOY_DSYM = /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET).dSYM.tar.gz


ifeq ($(OS_NAME),darwin)

release-bin-generate-copy-dsym:
	cd $(shell dirname $(BUN_RELEASE_BIN)) && tar -czvf $(shell basename $(BUN_DEPLOY_DSYM)) $(shell basename $(BUN_RELEASE_BIN)).dSYM && \
	mv $(shell basename $(BUN_DEPLOY_DSYM)) $(BUN_DEPLOY_DSYM)

endif

ifeq ($(OS_NAME),linux)
release-bin-generate-copy-dsym:
endif

release-bin-generate-copy:
	rm -rf /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET) $(BUN_DEPLOY_ZIP)
	mkdir -p /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET)
	cp $(BUN_RELEASE_BIN) /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET)/bun

release-bin-generate: release-bin-generate-copy release-bin-generate-zip release-bin-generate-copy-dsym


release-bin-check-version:
	test $(shell eval $(BUN_RELEASE_BIN) --version) = $(PACKAGE_JSON_VERSION)

release-bin-check: release-bin-check-version

ifeq ($(OS_NAME),linux)

release-bin-check: release-bin-check-version
# force it to run
	@make -B check-glibc-version-dependency
endif


release-bin-push-bin:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP) --repo $(BUN_AUTO_UPDATER_REPO)


ifeq ($(OS_NAME),darwin)
release-bin-push-dsym:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM) --repo $(BUN_AUTO_UPDATER_REPO)
endif

ifeq ($(OS_NAME),linux)
release-bin-push-dsym:
endif

TINYCC_DIR ?= $(realpath $(BUN_DEPS_DIR)/tinycc)

release-bin-push: release-bin-push-bin release-bin-push-dsym
generate-release-bin-as-zip: release-bin-generate release-bin-codesign
release-bin-without-push: test-all release-bin-check generate-release-bin-as-zip

release-bin: release-bin-without-push release-bin-push



release-bin-dir:
	echo $(PACKAGE_DIR)

dev-obj:
	$(ZIG) build obj --prominent-compile-errors

dev-obj-linux:
	$(ZIG) build obj -Dtarget=x86_64-linux-gnu

dev: mkdir-dev dev-obj bun-link-lld-debug bun-codesign-debug

mkdir-dev:
	mkdir -p $(DEBUG_PACKAGE_DIR)/bin

test-install:
	cd test/scripts && $(NPM_CLIENT) install

test-bun-dev:
	BUN_BIN=$(RELEASE_BUN) bash test/apps/bun-dev.sh
	BUN_BIN=$(RELEASE_BUN) bash test/apps/bun-dev-index-html.sh

test-dev-bun-dev:
	BUN_BIN=$(DEBUG_BUN) bash test/apps/bun-dev.sh
	BUN_BIN=$(DEBUG_BUN) bash test/apps/bun-dev-index-html.sh

test-all: test-install test-with-hmr test-no-hmr test-create-next test-create-react test-bun-run test-bun-install test-bun-dev

copy-test-node-modules:
	rm -rf test/snippets/package-json-exports/node_modules || echo "";
	cp -r test/snippets/package-json-exports/_node_modules_copy test/snippets/package-json-exports/node_modules || echo "";
kill-bun:
	-killall -9 bun bun-debug

test-dev-create-next:
	BUN_BIN=$(DEBUG_BUN) bash test/apps/bun-create-next.sh

test-dev-create-react:
	BUN_BIN=$(DEBUG_BUN) bash test/apps/bun-create-react.sh

test-create-next:
	BUN_BIN=$(RELEASE_BUN) bash test/apps/bun-create-next.sh

test-bun-run:
	cd test/apps && BUN_BIN=$(RELEASE_BUN) bash ./bun-run-check.sh

test-bun-install: test-bun-install-git-status
	cd test/apps && JS_RUNTIME=$(RELEASE_BUN) NPM_CLIENT=$(RELEASE_BUN) bash ./bun-install.sh
	cd test/apps && BUN_BIN=$(RELEASE_BUN) bash ./bun-install-utf8.sh

test-bun-install-git-status:
	cd test/apps && JS_RUNTIME=$(RELEASE_BUN) BUN_BIN=$(RELEASE_BUN) bash ./bun-install-lockfile-status.sh

test-dev-bun-install: test-dev-bun-install-git-status
	cd test/apps && JS_RUNTIME=$(DEBUG_BUN) NPM_CLIENT=$(DEBUG_BUN) bash ./bun-install.sh
	cd test/apps && BUN_BIN=$(DEBUG_BUN) bash ./bun-install-utf8.sh

test-dev-bun-install-git-status:
	cd test/apps && BUN_BIN=$(DEBUG_BUN) bash ./bun-install-lockfile-status.sh

test-create-react:
	BUN_BIN=$(RELEASE_BUN) bash test/apps/bun-create-react.sh

test-with-hmr: kill-bun copy-test-node-modules
	BUN_BIN=$(RELEASE_BUN) node test/scripts/browser.js

test-no-hmr: kill-bun copy-test-node-modules
	-killall bun -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(RELEASE_BUN) node test/scripts/browser.js

test-dev-with-hmr: copy-test-node-modules
	-killall bun-debug -9;
	BUN_BIN=$(DEBUG_BUN) node test/scripts/browser.js

test-dev-no-hmr: copy-test-node-modules
	-killall bun-debug -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(DEBUG_BUN) node test/scripts/browser.js

test-dev-bun-run:
	cd test/apps && BUN_BIN=$(DEBUG_BUN) bash bun-run-check.sh

test-dev-all: test-dev-with-hmr test-dev-no-hmr test-dev-create-next test-dev-create-react test-dev-bun-run test-dev-bun-install test-dev-bun-dev
test-dev-bunjs:

test-dev: test-dev-with-hmr

jsc-copy-headers:
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/heap/WeakHandleOwner.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/WeakHandleOwner.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyClassStructureInlines.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyClassStructureInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyPropertyInlines.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyPropertyInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayViewPrototype.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayViewPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayPrototypes.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayPrototypes.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JIT.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JIT.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubInfo.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubInfo.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/PolymorphicAccess.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/PolymorphicAccess.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AccessCase.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AccessCase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/ObjectPropertyConditionSet.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ObjectPropertyConditionSet.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/PolyProtoAccessChain.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/PolyProtoAccessChain.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/PutKind.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/PutKind.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubClearingWatchpoint.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubClearingWatchpoint.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AdaptiveInferredPropertyValueWatchpointBase.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AdaptiveInferredPropertyValueWatchpointBase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StubInfoSummary.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StubInfoSummary.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/CommonSlowPaths.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/CommonSlowPaths.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/DirectArguments.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DirectArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GenericArguments.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GenericArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/ScopedArguments.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ScopedArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSLexicalEnvironment.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSLexicalEnvironment.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITDisassembler.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITDisassembler.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITInlineCacheGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITInlineCacheGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMathIC.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathIC.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITAddGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITAddGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMathICInlineResult.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathICInlineResult.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/SnippetOperand.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SnippetOperand.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMulGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMulGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITNegGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITNegGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITSubGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITSubGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/Repatch.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/Repatch.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITRightShiftGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITRightShiftGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITBitBinaryOpGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITBitBinaryOpGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JSInterfaceJIT.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSInterfaceJIT.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/llint/LLIntData.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LLIntData.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/FunctionCodeBlock.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/FunctionCodeBlock.h
	find $(WEBKIT_RELEASE_DIR)/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

# This is a workaround for a JSC bug that impacts aarch64
# on macOS, it never requests JIT permissions
jsc-force-fastjit:
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/assembler/FastJITPermissions.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.cpp

jsc-build-mac-compile:
	mkdir -p $(WEBKIT_RELEASE_DIR) $(WEBKIT_DIR);
	cd $(WEBKIT_RELEASE_DIR) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON \
			-DCMAKE_BUILD_TYPE=relwithdebuginfo \
			-DUSE_THIN_ARCHIVES=OFF \
			-DENABLE_FTL_JIT=ON \
			-G Ninja \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR) && \
	CFLAGS="$(CFLAGS) $(BITCODE_OR_SECTIONS) -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) $(BITCODE_OR_SECTIONS)  -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config Release --target jsc

jsc-build-mac-compile-lto:
	mkdir -p $(WEBKIT_RELEASE_DIR_LTO) $(WEBKIT_DIR);
	cd $(WEBKIT_RELEASE_DIR_LTO) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON \
			-DCMAKE_BUILD_TYPE=Release \
			-DUSE_THIN_ARCHIVES=OFF \
			-DCMAKE_C_FLAGS="-flto=full" \
			-DCMAKE_CXX_FLAGS="-flto=full" \
			-DENABLE_FTL_JIT=ON \
			-G Ninja \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR_LTO) && \
	CFLAGS="$(CFLAGS) -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR_LTO) --config Release --target jsc

jsc-build-mac-compile-debug:
	mkdir -p $(WEBKIT_DEBUG_DIR) $(WEBKIT_DIR);
	cd $(WEBKIT_DEBUG_DIR) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=Debug \
			-DUSE_THIN_ARCHIVES=OFF \
			-DENABLE_FTL_JIT=ON \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			-DUSE_VISIBILITY_ATTRIBUTE=1 \
			$(WEBKIT_DIR) \
			$(WEBKIT_DEBUG_DIR) && \
	CFLAGS="$(CFLAGS) -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -ffat-lto-objects" \
		cmake --build $(WEBKIT_DEBUG_DIR) --config Debug --target jsc

jsc-build-linux-compile-config:
	mkdir -p $(WEBKIT_RELEASE_DIR)
	cd $(WEBKIT_RELEASE_DIR) && \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=relwithdebuginfo \
			-DUSE_THIN_ARCHIVES=OFF \
			-DENABLE_FTL_JIT=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			-DJSEXPORT_PRIVATE=WTF_EXPORT_DECLARATION \
			-USE_VISIBILITY_ATTRIBUTE=1 \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			-DCMAKE_CXX_COMPILER=$(CXX) \
			-DCMAKE_C_COMPILER=$(CC) \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR)

# If you get "Error: could not load cache"
# run  rm -rf src/bun.js/WebKit/CMakeCache.txt
jsc-build-linux-compile-build:
		mkdir -p $(WEBKIT_RELEASE_DIR)  && \
		cd $(WEBKIT_RELEASE_DIR)  && \
	CFLAGS="$(CFLAGS) -Wl,--whole-archive -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -Wl,--whole-archive -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config relwithdebuginfo --target jsc


jsc-build-mac: jsc-force-fastjit jsc-build-mac-compile jsc-build-mac-copy

jsc-build-linux: jsc-build-linux-compile-config jsc-build-linux-compile-build jsc-build-mac-copy

jsc-build-mac-copy:
	cp $(WEBKIT_RELEASE_DIR)/lib/libJavaScriptCore.a $(BUN_DEPS_OUT_DIR)/libJavaScriptCore.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libLowLevelInterpreterLib.a $(BUN_DEPS_OUT_DIR)/libLowLevelInterpreterLib.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libWTF.a $(BUN_DEPS_OUT_DIR)/libWTF.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libbmalloc.a $(BUN_DEPS_OUT_DIR)/libbmalloc.a

clean-jsc:
	cd src/bun.js/WebKit && rm -rf **/CMakeCache.txt **/CMakeFiles && rm -rf src/bun.js/WebKit/WebKitBuild
clean-bindings:
	rm -rf $(OBJ_DIR)/*.o
	rm -rf $(OBJ_DIR)/webcore/*.o
	rm -rf $(BINDINGS_OBJ)

clean: clean-bindings
	rm $(BUN_DEPS_DIR)/*.a $(BUN_DEPS_DIR)/*.o
	(cd $(BUN_DEPS_DIR)/mimalloc && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/libarchive && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/boringssl && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/picohttp && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/zlib && make clean) || echo "";

jsc-bindings-mac: $(OBJ_FILES) $(WEBCORE_OBJ_FILES) $(SQLITE_OBJ_FILES) $(BUILTINS_OBJ_FILES)

mimalloc-debug:
	rm -rf $(BUN_DEPS_DIR)/mimalloc/CMakeCache* $(BUN_DEPS_DIR)/mimalloc/CMakeFiles
	cd $(BUN_DEPS_DIR)/mimalloc; make clean || echo ""; \
		CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS_WITHOUT_RELEASE) ${MIMALLOC_OVERRIDE_FLAG} \
			-DCMAKE_BUILD_TYPE=Debug \
			-DMI_DEBUG_FULL=1 \
			-DMI_SKIP_COLLECT_ON_EXIT=1 \
			-DMI_BUILD_SHARED=OFF \
			-DMI_BUILD_STATIC=ON \
			-DMI_BUILD_TESTS=OFF \
			-DMI_OSX_ZONE=OFF \
			-DMI_OSX_INTERPOSE=OFF \
			-DMI_BUILD_OBJECT=ON \
			-DMI_USE_CXX=ON \
			-DMI_OVERRIDE=OFF \
			-DCMAKE_C_FLAGS="$(CFLAGS)" \
			-DCMAKE_CXX_FLAGS="$(CFLAGS)" \
			. \
			&& make -j $(CPUS);
	cp $(BUN_DEPS_DIR)/mimalloc/$(_MIMALLOC_DEBUG_FILE) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)


# mimalloc is built as object files so that it can overload the system malloc on linux
# on macOS, OSX_INTERPOSE and OSX_ZONE do not work correctly.
# More precisely, they cause assertion failures and occasional segfaults
mimalloc:
	rm -rf $(BUN_DEPS_DIR)/mimalloc/CMakeCache* $(BUN_DEPS_DIR)/mimalloc/CMakeFiles
	cd $(BUN_DEPS_DIR)/mimalloc; \
		CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) \
			-DMI_SKIP_COLLECT_ON_EXIT=1 \
			-DMI_BUILD_SHARED=OFF \
			-DMI_BUILD_STATIC=ON \
			-DMI_BUILD_TESTS=OFF \
			-DMI_OSX_ZONE=OFF \
			-DMI_OSX_INTERPOSE=OFF \
			-DMI_BUILD_OBJECT=ON \
			-DMI_USE_CXX=ON \
			-DMI_OVERRIDE=OFF \
			-DMI_OSX_ZONE=OFF \
			-DCMAKE_C_FLAGS="$(CFLAGS)" \
			 .\
			&& make -j $(CPUS);
	cp $(BUN_DEPS_DIR)/mimalloc/$(MIMALLOC_INPUT_PATH) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)


mimalloc-wasm:
	cd $(BUN_DEPS_DIR)/mimalloc; emcmake cmake -DMI_BUILD_SHARED=OFF -DMI_BUILD_STATIC=ON -DMI_BUILD_TESTS=OFF -DMI_BUILD_OBJECT=ON ${MIMALLOC_OVERRIDE_FLAG} -DMI_USE_CXX=ON .; emmake make;
	cp $(BUN_DEPS_DIR)/mimalloc/$(MIMALLOC_INPUT_PATH) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE).wasm

bun-link-lld-debug:
	$(CXX) $(BUN_LLD_FLAGS_DEBUG) $(DEBUG_FLAGS) $(SYMBOLS) \
		-g \
		$(DEBUG_BIN)/bun-debug.o \
		-W \
		-o $(DEBUG_BIN)/bun-debug

bun-link-lld-debug-no-jsc:
	$(CXX) $(BUN_LLD_FLAGS_WITHOUT_JSC) $(SYMBOLS) \
		-g \
		$(DEBUG_BIN)/bun-debug.o \
		-W \
		-o $(DEBUG_BIN)/bun-debug


bun-link-lld-release-no-jsc:
	$(CXX) $(BUN_LLD_FLAGS_WITHOUT_JSC) $(SYMBOLS) \
		-g \
		$(BUN_RELEASE_BIN).o \
		-W \
		-o $(BUN_RELEASE_BIN) -Wl,-undefined,dynamic_lookup -Wl,-why_load

bun-relink-copy:
	cp /tmp/bun-$(PACKAGE_JSON_VERSION).o $(BUN_RELEASE_BIN).o



bun-link-lld-release:
	$(CXX) $(BUN_LLD_FLAGS) $(SYMBOLS) \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		$(OPTIMIZATION_LEVEL) $(RELEASE_FLAGS)
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile

bun-link-lld-release-no-lto:
	$(CXX) $(BUN_LLD_FLAGS_FAST) $(SYMBOLS) \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		$(OPTIMIZATION_LEVEL) $(RELEASE_FLAGS)
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile


ifeq ($(OS_NAME),darwin)
bun-link-lld-release-dsym:
	$(DSYMUTIL) -o $(BUN_RELEASE_BIN).dSYM $(BUN_RELEASE_BIN)
	-$(STRIP) $(BUN_RELEASE_BIN)
	cp $(BUN_RELEASE_BIN).o /tmp/bun-$(PACKAGE_JSON_VERSION).o

copy-to-bun-release-dir-dsym:
	gzip --keep -c $(PACKAGE_DIR)/bun.dSYM > $(BUN_RELEASE_DIR)/bun.dSYM.gz
endif

ifeq ($(OS_NAME),linux)
bun-link-lld-release-dsym:
	mv $(BUN_RELEASE_BIN).o /tmp/bun-$(PACKAGE_JSON_VERSION).o
copy-to-bun-release-dir-dsym:

endif


bun-relink: bun-relink-copy bun-link-lld-release bun-link-lld-release-dsym
bun-relink-fast: bun-relink-copy bun-link-lld-release-no-lto

wasm-return1:
	zig build-lib -OReleaseSmall test/bun.js/wasm-return-1-test.zig -femit-bin=test/bun.js/wasm-return-1-test.wasm -target wasm32-freestanding

generate-sink:
	bun src/bun.js/generate-jssink.js
	$(WEBKIT_DIR)/Source/JavaScriptCore/create_hash_table src/bun.js/bindings/JSSink.cpp > src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/#include "Lookup.h"//' src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/namespace JSC {//' src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/} \/\/ namespace JSC//' src/bun.js/bindings/JSSinkLookupTable.h

EMIT_LLVM_FOR_RELEASE=-emit-llvm -flto="full"
EMIT_LLVM_FOR_DEBUG=
EMIT_LLVM=$(EMIT_LLVM_FOR_RELEASE)

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) $(CLANG_FLAGS) $(UWS_INCLUDE) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=1000 \
		$(EMIT_LLVM) \
		-g3 -c -o $@ $<

$(OBJ_DIR)/%.o: $(SRC_DIR)/webcore/%.cpp
	$(CXX) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=1000 \
		$(EMIT_LLVM) \
		-g3 -c -o $@ $<

$(OBJ_DIR)/%.o: $(SRC_DIR)/sqlite/%.cpp
	$(CXX) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=1000 \
		$(EMIT_LLVM) \
		-g3 -c -o $@ $<

$(OBJ_DIR)/%.o: src/bun.js/builtins/%.cpp
	$(CXX) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=1000 \
		$(EMIT_LLVM) \
		-g3 -c -o $@ $<

sizegen:
	$(CXX) src/bun.js/headergen/sizegen.cpp -o $(BUN_TMP_DIR)/sizegen $(CLANG_FLAGS) -O1
	$(BUN_TMP_DIR)/sizegen > src/bun.js/bindings/sizes.zig


# Linux uses bundled SQLite3
ifeq ($(OS_NAME),linux)
sqlite:
	$(CC) $(CFLAGS) $(INCLUDE_DIRS) -DSQLITE_ENABLE_COLUMN_METADATA= -DSQLITE_MAX_VARIABLE_NUMBER=250000 -DSQLITE_ENABLE_RTREE=1 -DSQLITE_ENABLE_FTS3=1 -DSQLITE_ENABLE_FTS3_PARENTHESIS=1 -DSQLITE_ENABLE_JSON1=1 $(SRC_DIR)/sqlite/sqlite3.c -c -o $(SQLITE_OBJECT)
endif

picohttp:
	 $(CC) $(CFLAGS) $(OPTIMIZATION_LEVEL) -g -fPIC -c $(BUN_DEPS_DIR)/picohttpparser/picohttpparser.c -I$(BUN_DEPS_DIR) -o $(BUN_DEPS_OUT_DIR)/picohttpparser.o; cd ../../

analytics:
	./node_modules/.bin/peechy --schema src/analytics/schema.peechy --zig src/analytics/analytics_schema.zig
	$(ZIG) fmt src/analytics/analytics_schema.zig

analytics-features:
	@cd misctools; $(ZIG) run --main-pkg-path ../ ./features.zig

find-unused-zig-files:
	@bash ./misctools/find-unused-zig.sh

generate-unit-tests:
	@bash ./misctools/generate-test-file.sh

fmt-all:
	find src -name "*.zig" -exec $(ZIG) fmt {} \;

unit-tests: generate-unit-tests run-unit-tests

ifeq (test, $(firstword $(MAKECMDGOALS)))
testpath := $(firstword $(wordlist 2, $(words $(MAKECMDGOALS)), $(MAKECMDGOALS)))
testfilter := $(wordlist 3, $(words $(MAKECMDGOALS)), $(MAKECMDGOALS))
testbinpath := zig-out/bin/test
testbinpath := $(lastword $(testfilter))

ifeq ($(if $(patsubst /%,,$(testbinpath)),,yes),yes)
testfilterflag := --test-filter "$(filter-out $(testbinpath), $(testfilter))"

endif

ifneq ($(if $(patsubst /%,,$(testbinpath)),,yes),yes)
testbinpath := zig-out/bin/test
ifneq ($(strip $(testfilter)),)
testfilterflag := --test-filter "$(testfilter)"
endif
endif

  testname := $(shell basename $(testpath))


  $(eval $(testname):;@true)

  ifeq ($(words $(testfilter)), 0)
testfilterflag :=  --test-name-prefix "$(testname): "
endif

ifeq ($(testfilterflag), undefined)
testfilterflag :=  --test-name-prefix "$(testname): "
endif


endif

ifeq (build-unit, $(firstword $(MAKECMDGOALS)))
testpath := $(firstword $(wordlist 2, $(words $(MAKECMDGOALS)), $(MAKECMDGOALS)))
testfilter := $(wordlist 3, $(words $(MAKECMDGOALS)), $(MAKECMDGOALS))
testbinpath := zig-out/bin/test
testbinpath := $(lastword $(testfilter))

ifeq ($(if $(patsubst /%,,$(testbinpath)),,yes),yes)
testfilterflag := --test-filter "$(filter-out $(testbinpath), $(testfilter))"

endif

ifneq ($(if $(patsubst /%,,$(testbinpath)),,yes),yes)
testbinpath := zig-out/bin/test
ifneq ($(strip $(testfilter)),)
testfilterflag := --test-filter "$(testfilter)"
endif
endif

  testname := $(shell basename $(testpath))


$(eval $(testname):;@true)
$(eval $(testfilter):;@true)
$(eval $(testpath):;@true)

  ifeq ($(words $(testfilter)), 0)
testfilterflag :=  --test-name-prefix "$(testname): "
endif

ifeq ($(testfilterflag), undefined)
testfilterflag :=  --test-name-prefix "$(testname): "
endif



endif

build-unit:
	@rm -rf zig-out/bin/$(testname)
	@mkdir -p zig-out/bin
	zig test  $(realpath $(testpath)) \
	$(testfilterflag) \
	$(PACKAGE_MAP) \
	--main-pkg-path $(BUN_DIR) \
	--test-no-exec \
	-fPIC \
	-femit-bin=zig-out/bin/$(testname) \
	-fcompiler-rt \
	-lc -lc++ \
	--cache-dir /tmp/zig-cache-bun-$(testname)-$(basename $(lastword $(testfilter))) \
	-fallow-shlib-undefined \
	 && \
	cp zig-out/bin/$(testname) $(testbinpath)

run-all-unit-tests:
	@rm -rf zig-out/bin/__main_test
	@mkdir -p zig-out/bin
	zig test src/main.zig \
	$(PACKAGE_MAP) \
	--main-pkg-path $(BUN_DIR) \
	--test-no-exec \
	-fPIC \
	-femit-bin=zig-out/bin/__main_test \
	-fcompiler-rt \
	-lc -lc++ \
	--cache-dir /tmp/zig-cache-bun-__main_test \
	-fallow-shlib-undefined \
	$(ARCHIVE_FILES) $(ICU_FLAGS) $(JSC_FILES) $(JSC_BINDINGS) && \
	zig-out/bin/__main_test $(ZIG)

run-unit:
	@zig-out/bin/$(testname) $(ZIG)



test: build-unit run-unit

integration-test-dev:
	USE_EXISTING_PROCESS=true TEST_SERVER_URL=http://localhost:3000 node test/scripts/browser.js

copy-install:
	cp src/cli/install.sh ../bun.sh/docs/install.html



copy-to-bun-release-dir: copy-to-bun-release-dir-bin copy-to-bun-release-dir-dsym

copy-to-bun-release-dir-bin:
	cp -r $(PACKAGE_DIR)/bun $(BUN_RELEASE_DIR)/bun
	cp -r $(PACKAGE_DIR)/bun-profile $(BUN_RELEASE_DIR)/bun-profile


PACKAGE_MAP = --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_$(OS_NAME).zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-end --pkg-end --pkg-end --pkg-end --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin clap $(BUN_DIR)/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-end --pkg-end --pkg-end --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/boringssl.zig --pkg-end --pkg-begin javascript_core $(BUN_DIR)/src/jsc.zig --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-end --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-end


bun: vendor identifier-cache build-obj bun-link-lld-release bun-codesign-release-local
