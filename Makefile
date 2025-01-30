# ------------------------------------------------------------
#                         WARNING
# ------------------------------------------------------------
# This file is very old and will be removed soon!
# You can build Bun using `cmake` or `bun run build`
# ------------------------------------------------------------

SHELL := $(shell which bash) # Use bash syntax to be consistent

OS_NAME := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH_NAME_RAW := $(shell uname -m)
BUN_AUTO_UPDATER_REPO = Jarred-Sumner/bun-releases-for-updater

CMAKE_CXX_COMPILER_LAUNCHER_FLAG :=

# 'make' command will trigger the help target
.DEFAULT_GOAL := help

# On Linux ARM64, uname -m reports aarch64
ifeq ($(ARCH_NAME_RAW),aarch64)
ARCH_NAME_RAW = arm64
endif

CPU_TARGET ?= native
MARCH_NATIVE = -mtune=$(CPU_TARGET)
NATIVE_OR_OLD_MARCH =

MMD_IF_LOCAL =
DEFAULT_MIN_MACOS_VERSION=
ARCH_NAME :=
DOCKER_BUILDARCH =
ifeq ($(ARCH_NAME_RAW),arm64)
ARCH_NAME = aarch64
DOCKER_BUILDARCH = arm64
BREW_PREFIX_PATH = /opt/homebrew
DEFAULT_MIN_MACOS_VERSION = 13.0
MARCH_NATIVE = -mtune=$(CPU_TARGET)
ifeq ($(OS_NAME),linux)
MARCH_NATIVE = -march=armv8-a+crc -mtune=ampere1
endif
else
ARCH_NAME = x64
DOCKER_BUILDARCH = amd64
BREW_PREFIX_PATH = /usr/local
DEFAULT_MIN_MACOS_VERSION = 10.14
MARCH_NATIVE = -march=$(CPU_TARGET) -mtune=$(CPU_TARGET)
NATIVE_OR_OLD_MARCH = -march=nehalem
endif

MIN_MACOS_VERSION ?= $(DEFAULT_MIN_MACOS_VERSION)
BUN_BASE_VERSION = 1.0
CI ?= false

AR=

ifeq ($(CI), false)
	MMD_IF_LOCAL = -MMD
endif

BUN_OR_NODE = $(shell which bun 2>/dev/null || which node 2>/dev/null)



CXX_VERSION=c++2a
TRIPLET = $(OS_NAME)-$(ARCH_NAME)
PACKAGE_NAME = bun-$(TRIPLET)
PACKAGES_REALPATH = $(realpath packages)
PACKAGE_DIR = $(PACKAGES_REALPATH)/$(PACKAGE_NAME)
DEBUG_PACKAGE_DIR = $(PACKAGES_REALPATH)/debug-$(PACKAGE_NAME)
RELEASE_BUN = $(PACKAGE_DIR)/bun
DEBUG_BIN = $(DEBUG_PACKAGE_DIR)
DEBUG_BUN = $(DEBUG_BIN)/bun-debug
BUILD_ID = $(shell cat ./src/build-id)
PACKAGE_JSON_VERSION = $(BUN_BASE_VERSION).$(BUILD_ID)
BUN_BUILD_TAG = bun-v$(PACKAGE_JSON_VERSION)
BUN_RELEASE_BIN = $(PACKAGE_DIR)/bun
PRETTIER ?= $(shell which prettier 2>/dev/null || echo "./node_modules/.bin/prettier")
ESBUILD = "$(shell which esbuild 2>/dev/null || echo "./node_modules/.bin/esbuild")"
DSYMUTIL ?= $(shell which dsymutil 2>/dev/null || which dsymutil-15 2>/dev/null)
WEBKIT_DIR ?= $(realpath vendor/WebKit)
WEBKIT_RELEASE_DIR ?= $(WEBKIT_DIR)/WebKitBuild/Release
WEBKIT_DEBUG_DIR ?= $(WEBKIT_DIR)/WebKitBuild/Debug
WEBKIT_RELEASE_DIR_LTO ?= $(WEBKIT_DIR)/WebKitBuild/ReleaseLTO


NPM_CLIENT = "$(shell which bun 2>/dev/null || which npm 2>/dev/null)"
ZIG ?= $(shell which zig 2>/dev/null || echo -e "error: Missing zig. Please make sure zig is in PATH. Or set ZIG=/path/to-zig-executable")

# We must use the same compiler version for the JavaScriptCore bindings and JavaScriptCore
# If we don't do this, strange memory allocation failures occur.
# This is easier to happen than you'd expect.
# Using realpath here causes issues because clang uses clang++ as a symlink
# so if that's resolved, it won't build for C++
REAL_CC = $(shell which clang-18 2>/dev/null || which clang 2>/dev/null)
REAL_CXX = $(shell which clang++-18 2>/dev/null || which clang++ 2>/dev/null)
CLANG_FORMAT = $(shell which clang-format-18 2>/dev/null || which clang-format 2>/dev/null)

CC = $(REAL_CC)
CXX = $(REAL_CXX)
CCACHE_CC_OR_CC := $(REAL_CC)

CCACHE_PATH := $(shell which ccache 2>/dev/null)

CCACHE_CC_FLAG = CC=$(CCACHE_CC_OR_CC)

ifeq (,$(findstring,$(shell which ccache 2>/dev/null),ccache))
	CMAKE_CXX_COMPILER_LAUNCHER_FLAG := -DCMAKE_CXX_COMPILER_LAUNCHER=$(CCACHE_PATH) -DCMAKE_C_COMPILER_LAUNCHER=$(CCACHE_PATH)
	CCACHE_CC_OR_CC := "$(CCACHE_PATH) $(REAL_CC)"
	export CCACHE_COMPILERTYPE = clang
	CCACHE_CC_FLAG = CC=$(CCACHE_CC_OR_CC) CCACHE_COMPILER=$(REAL_CC)
	CCACHE_CXX_FLAG = CXX=$(CCACHE_PATH) CCACHE_COMPILER=$(REAL_CXX)
endif

CXX_WITH_CCACHE = $(CCACHE_PATH) $(CXX)
CC_WITH_CCACHE = $(CCACHE_PATH) $(CC)

ifeq ($(OS_NAME),darwin)
# Find LLVM
	ifeq ($(wildcard $(LLVM_PREFIX)),)
		LLVM_PREFIX = $(shell brew --prefix llvm@18)
	endif
	ifeq ($(wildcard $(LLVM_PREFIX)),)
		LLVM_PREFIX = $(shell brew --prefix llvm)
	endif
	ifeq ($(wildcard $(LLVM_PREFIX)),)
#   This is kinda ugly, but I can't find a better way to error :(
		LLVM_PREFIX = $(shell echo -e "error: Unable to find llvm. Please run 'brew install llvm@18' or set LLVM_PREFIX=/path/to/llvm")
	endif

	LDFLAGS += -L$(LLVM_PREFIX)/lib
	CPPFLAGS += -I$(LLVM_PREFIX)/include
	CC = $(LLVM_PREFIX)/bin/clang
	CXX = $(LLVM_PREFIX)/bin/clang++
	CODESIGN_IDENTITY ?= $(shell security find-identity -v -p codesigning | awk '/Apple Development/ { print $$2 }')
endif

# macOS sed is different
SED = $(shell which gsed 2>/dev/null || which sed 2>/dev/null)

BUN_DIR ?= $(shell dirname $(realpath $(firstword $(MAKEFILE_LIST))))
BUN_DEPS_DIR ?= $(shell pwd)/vendor
BUN_DEPS_OUT_DIR ?= $(shell pwd)/build/release
CPU_COUNT = 2
ifeq ($(OS_NAME),darwin)
CPU_COUNT = $(shell sysctl -n hw.logicalcpu)
endif

ifeq ($(OS_NAME),linux)
CPU_COUNT = $(shell nproc)
endif

CPUS ?= $(CPU_COUNT)
USER ?= $(echo $USER)

BUN_RELEASE_DIR ?= $(shell pwd)/../bun-release

OPENSSL_VERSION = OpenSSL_1_1_1l
LIBICONV_PATH ?= $(BREW_PREFIX_PATH)/opt/libiconv/lib/libiconv.a

OPENSSL_LINUX_DIR = $(BUN_DEPS_DIR)/openssl/openssl-OpenSSL_1_1_1l

CMAKE_FLAGS_WITHOUT_RELEASE = -DCMAKE_C_COMPILER=$(CC) \
	-DCMAKE_CXX_COMPILER=$(CXX) \
	-DCMAKE_OSX_DEPLOYMENT_TARGET=$(MIN_MACOS_VERSION) \
	$(CMAKE_CXX_COMPILER_LAUNCHER_FLAG) \
	-DCMAKE_AR=$(AR) \
	-DCMAKE_RANLIB=$(which llvm-18-ranlib 2>/dev/null || which llvm-ranlib 2>/dev/null) \
	-DCMAKE_CXX_STANDARD=20 \
	-DCMAKE_C_STANDARD=17 \
	-DCMAKE_CXX_STANDARD_REQUIRED=ON \
	-DCMAKE_C_STANDARD_REQUIRED=ON \
	-DCMAKE_CXX_EXTENSIONS=ON 



CMAKE_FLAGS = $(CMAKE_FLAGS_WITHOUT_RELEASE) -DCMAKE_BUILD_TYPE=Release

# SQLite3 is dynamically linked on macOS
# it is about 30% faster to use system SQLite3 on macOS (something something kernel page cache)
# on Linux, it is statically linked
SQLITE_OBJECT =



LIBTOOL=libtoolize
ifeq ($(OS_NAME),darwin)
LIBTOOL=glibtoolize
AR=$(LLVM_PREFIX)/bin/llvm-ar
BITCODE_OR_SECTIONS=
endif

ifeq ($(OS_NAME),linux)
LIBICONV_PATH =
AR = $(shell which llvm-ar-18 2>/dev/null || which llvm-ar 2>/dev/null || which ar 2>/dev/null)
endif

OPTIMIZATION_LEVEL=-O3 $(MARCH_NATIVE)
DEBUG_OPTIMIZATION_LEVEL= -O1 $(MARCH_NATIVE) -gdwarf-4
CFLAGS_WITHOUT_MARCH = $(MACOS_MIN_FLAG) $(OPTIMIZATION_LEVEL) -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden -mno-omit-leaf-frame-pointer -fno-omit-frame-pointer -fno-asynchronous-unwind-tables -fno-unwind-tables -fno-pie -fno-pic
BUN_CFLAGS = $(MACOS_MIN_FLAG) $(MARCH_NATIVE)  $(OPTIMIZATION_LEVEL) -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden  -mno-omit-leaf-frame-pointer -fno-omit-frame-pointer -fno-asynchronous-unwind-tables -fno-unwind-tables -fno-pie -fno-pic
BUN_TMP_DIR := /tmp/make-bun
CFLAGS=$(CFLAGS_WITHOUT_MARCH) $(MARCH_NATIVE)

# Set via postinstall
ifeq (,$(realpath $(JSC_BASE_DIR)))
	JSC_BASE_DIR = $(realpath $(firstword $(wildcard bun-webkit)))
	ifeq (,$(JSC_BASE_DIR))
		JSC_BASE_DIR = $(HOME)/webkit-build
	endif
endif

DEFAULT_JSC_LIB :=
DEFAULT_JSC_LIB_DEBUG :=

DEFAULT_JSC_LIB = $(JSC_BASE_DIR)/lib
DEFAULT_JSC_LIB_DEBUG = $(DEFAULT_JSC_LIB)

ifneq (,$(realpath $(WEBKIT_RELEASE_DIR_LTO)/lib))
DEFAULT_JSC_LIB = $(WEBKIT_RELEASE_DIR_LTO)/lib
endif

ifneq (,$(realpath $(WEBKIT_RELEASE_DIR)/lib))
DEFAULT_JSC_LIB_DEBUG = $(WEBKIT_RELEASE_DIR)/lib
endif

JSC_LIB ?= $(DEFAULT_JSC_LIB)
JSC_LIB_DEBUG ?= $(DEFAULT_JSC_LIB_DEBUG)

JSC_INCLUDE_DIR ?= $(JSC_BASE_DIR)/include
ZLIB_INCLUDE_DIR ?= $(BUN_DEPS_DIR)/zlib
ZLIB_LIB_DIR ?= $(BUN_DEPS_DIR)/zlib

JSC_FILES := $(JSC_LIB)/libJavaScriptCore.a $(JSC_LIB)/libWTF.a  $(JSC_LIB)/libbmalloc.a
JSC_FILES_DEBUG := $(JSC_LIB_DEBUG)/libJavaScriptCore.a $(JSC_LIB_DEBUG)/libWTF.a  $(JSC_LIB_DEBUG)/libbmalloc.a


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
JSC_BUILD_STEPS_DEBUG :=
ifeq ($(OS_NAME),linux)
	JSC_BUILD_STEPS += jsc-build-linux
	JSC_BUILD_STEPS_DEBUG += jsc-build-linux-debug
	_MIMALLOC_LINK = $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)
DEFAULT_LINKER_FLAGS= -pthread -ldl
endif
ifeq ($(OS_NAME),darwin)
    _MIMALLOC_OBJECT_FILE = 0
	JSC_BUILD_STEPS += jsc-build-mac jsc-copy-headers
	JSC_BUILD_STEPS_DEBUG += jsc-build-mac-debug
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




BUN_DEPLOY_DIR ?= /tmp/bun-$(PACKAGE_JSON_VERSION)

MACOSX_DEPLOYMENT_TARGET=$(MIN_MACOS_VERSION)
MACOS_MIN_FLAG=

POSIX_PKG_MANAGER=sudo apt

STRIP=

ifeq ($(OS_NAME),darwin)
STRIP=/usr/bin/strip
endif

ifeq ($(OS_NAME),linux)
STRIP=$(shell which llvm-strip 2>/dev/null || which llvm-strip-18 2>/dev/null || which strip 2>/dev/null || echo "Missing strip")
endif


HOMEBREW_PREFIX ?= $(BREW_PREFIX_PATH)


SRC_DIR := src/bun.js/bindings
MODULES_DIR := src/bun.js/modules
OBJ_DIR ?= src/bun.js/bindings-obj
DEBUG_OBJ_DIR := src/bun.js/debug-bindings-obj

SRC_PATH := $(realpath $(SRC_DIR))
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
MODULES_FILES := $(wildcard $(MODULES_DIR)/*.cpp)
SRC_WEBCORE_FILES := $(wildcard $(SRC_DIR)/webcore/*.cpp)
SRC_SQLITE_FILES := $(wildcard $(SRC_DIR)/sqlite/*.cpp)
SRC_NODE_OS_FILES := $(wildcard $(SRC_DIR)/node_os/*.cpp)
SRC_IO_FILES := $(wildcard src/io/*.cpp)
SRC_BUILTINS_FILES := $(wildcard  src/js/out/*.cpp)
SRC_WEBCRYPTO_FILES := $(wildcard $(SRC_DIR)/webcrypto/*.cpp)

OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
WEBCORE_OBJ_FILES := $(patsubst $(SRC_DIR)/webcore/%.cpp,$(OBJ_DIR)/%.o,$(SRC_WEBCORE_FILES))
SQLITE_OBJ_FILES := $(patsubst $(SRC_DIR)/sqlite/%.cpp,$(OBJ_DIR)/%.o,$(SRC_SQLITE_FILES))
NODE_OS_OBJ_FILES := $(patsubst $(SRC_DIR)/node_os/%.cpp,$(OBJ_DIR)/%.o,$(SRC_NODE_OS_FILES))
BUILTINS_OBJ_FILES := $(patsubst src/js/out/%.cpp,$(OBJ_DIR)/%.o,$(SRC_BUILTINS_FILES))
IO_FILES := $(patsubst src/io/%.cpp,$(OBJ_DIR)/%.o,$(SRC_IO_FILES))
MODULES_OBJ_FILES := $(patsubst $(MODULES_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(MODULES_FILES))
WEBCRYPTO_OBJ_FILES := $(patsubst $(SRC_DIR)/webcrypto/%.cpp,$(OBJ_DIR)/%.o,$(SRC_WEBCRYPTO_FILES))

DEBUG_OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_FILES))
DEBUG_WEBCORE_OBJ_FILES := $(patsubst $(SRC_DIR)/webcore/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_WEBCORE_FILES))
DEBUG_SQLITE_OBJ_FILES := $(patsubst $(SRC_DIR)/sqlite/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_SQLITE_FILES))
DEBUG_NODE_OS_OBJ_FILES := $(patsubst $(SRC_DIR)/node_os/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_NODE_OS_FILES))
DEBUG_BUILTINS_OBJ_FILES := $(patsubst src/js/out/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_BUILTINS_FILES))
DEBUG_IO_FILES := $(patsubst src/io/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(SRC_IO_FILES))
DEBUG_MODULES_OBJ_FILES := $(patsubst $(MODULES_DIR)/%.cpp,$(DEBUG_OBJ_DIR)/%.o,$(MODULES_FILES))
DEBUG_WEBCRYPTO_OBJ_FILES := $(patsubst $(SRC_DIR)/webcrypto/%.cpp, $(DEBUG_OBJ_DIR)/%.o, $(SRC_WEBCRYPTO_FILES))

BINDINGS_OBJ := $(OBJ_FILES) $(WEBCORE_OBJ_FILES) $(SQLITE_OBJ_FILES) $(NODE_OS_OBJ_FILES) $(BUILTINS_OBJ_FILES) $(IO_FILES) $(MODULES_OBJ_FILES) $(WEBCRYPTO_OBJ_FILES)
DEBUG_BINDINGS_OBJ := $(DEBUG_OBJ_FILES) $(DEBUG_WEBCORE_OBJ_FILES) $(DEBUG_SQLITE_OBJ_FILES) $(DEBUG_NODE_OS_OBJ_FILES) $(DEBUG_BUILTINS_OBJ_FILES) $(DEBUG_IO_FILES) $(DEBUG_MODULES_OBJ_FILES) $(DEBUG_WEBCRYPTO_OBJ_FILES)

-include $(BINDINGS_OBJ:.o=.d)
-include $(DEBUG_BINDINGS_OBJ:.o=.d)

ALL_JSC_INCLUDE_DIRS := -I$(WEBKIT_RELEASE_DIR)/WTF/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ICU/Headers \
		-I$(WEBKIT_RELEASE_DIR)/bmalloc/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ \
		-I$(WEBKIT_RELEASE_DIR)/include \
		-I$(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders \
		-I$(WEBKIT_RELEASE_DIR)/bmalloc/PrivateHeaders \
		-I$(WEBKIT_RELEASE_DIR)/WTF/PrivateHeaders

SHARED_INCLUDE_DIR = -I$(realpath src/bun.js/bindings)/ \
		-I$(realpath src/js/builtins/) \
		-I$(realpath src/js/out/) \
		-I$(realpath src/bun.js/bindings) \
		-I$(realpath src/bun.js/bindings/webcore) \
		-I$(realpath src/bun.js/bindings/webcrypto) \
		-I$(realpath src/bun.js/bindings/sqlite) \
		-I$(realpath src/bun.js/bindings/node_os) \
		-I$(realpath src/bun.js/modules) \
		-I$(JSC_INCLUDE_DIR)

MAC_INCLUDE_DIRS :=  $(ALL_JSC_INCLUDE_DIRS) \
		$(SHARED_INCLUDE_DIR) \
		-I$(WEBKIT_DIR)/Source \

LINUX_INCLUDE_DIRS := $(ALL_JSC_INCLUDE_DIRS) \
					   $(SHARED_INCLUDE_DIR) \
					  -I$(ZLIB_INCLUDE_DIR)


UWS_INCLUDE_DIR := -I$(BUN_DIR)/packages/bun-usockets/src -I$(BUN_DIR)/packages -I$(BUN_DEPS_DIR)


INCLUDE_DIRS := $(UWS_INCLUDE_DIR) -I$(BUN_DEPS_DIR)/mimalloc/include -I$(BUN_DEPS_DIR)/zstd/include -Isrc/napi -I$(BUN_DEPS_DIR)/boringssl/include -I$(BUN_DEPS_DIR)/c-ares/include -Isrc/bun.js/modules


ifeq ($(OS_NAME),linux)
	INCLUDE_DIRS += $(LINUX_INCLUDE_DIRS)
	SQLITE_OBJECT = $(realpath $(BUN_DEPS_OUT_DIR))/sqlite3.o
endif

ifeq ($(OS_NAME),darwin)
MACOS_MIN_FLAG=-mmacos-version-min=$(MIN_MACOS_VERSION)
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
ifeq ($(OS_NAME),linux)
LIB_ICU_PATH ?= $(JSC_LIB)
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
		-DNAPI_EXPERIMENTAL=ON \
		-DNDEBUG=1 \
		-DNOMINMAX \
		-DIS_BUILD \
		-DBUILDING_JSCONLY__ \
		-DASSERT_ENABLED=0 \
		-fvisibility=hidden \
		-fvisibility-inlines-hidden

ifeq ($(OS_NAME),darwin)
CLANG_FLAGS += -DBUN_FAST_TLS=1 -DUSE_BUN_FAST_TLS=1 -DHAVE_BUN_FAST_TLS=1
endif

PLATFORM_LINKER_FLAGS =

SYMBOLS=

# This flag is only added to webkit builds on Apple platforms
# It has something to do with ICU
ifeq ($(OS_NAME), darwin)
SYMBOLS=-exported_symbols_list $(realpath src/symbols.txt)
PLATFORM_LINKER_FLAGS += -DDU_DISABLE_RENAMING=1 \
		-lstdc++ \
		-fno-keep-static-consts -lresolv
endif

ifeq ($(OS_NAME),linux)
SYMBOLS=-Wl,--dynamic-list $(realpath src/symbols.dyn) -Wl,--version-script=$(realpath src/linker.lds)
endif

SHARED_LIB_EXTENSION = .so

JSC_BINDINGS = $(BINDINGS_OBJ) $(JSC_FILES)
JSC_BINDINGS_DEBUG = $(DEBUG_BINDINGS_OBJ) $(JSC_FILES_DEBUG)

RELEASE_FLAGS=
DEBUG_FLAGS=


ifeq ($(OS_NAME), darwin)
	RELEASE_FLAGS += -Wl,-dead_strip -Wl,-dead_strip_dylibs
	DEBUG_FLAGS += -Wl,-dead_strip -Wl,-dead_strip_dylibs
	SHARED_LIB_EXTENSION = .dylib
endif

MINIMUM_ARCHIVE_FILES = -L$(BUN_DEPS_OUT_DIR) \
	-larchive \
	-lz \
	$(BUN_DEPS_OUT_DIR)/picohttpparser.o \
	$(_MIMALLOC_LINK) \
	-ldecrepit \
	-lssl \
	-lcrypto \
	-llolhtml

ARCHIVE_FILES_WITHOUT_LIBCRYPTO = $(MINIMUM_ARCHIVE_FILES) \
		-larchive \
		-ltcc \
		-lusockets \
		-lcares \
		-lzstd \
		$(BUN_DEPS_OUT_DIR)/libuwsockets.o \
		$(BUN_DEPS_OUT_DIR)/liblshpack.a

ARCHIVE_FILES = $(ARCHIVE_FILES_WITHOUT_LIBCRYPTO)

STATIC_MUSL_FLAG ?=

WRAP_SYMBOLS_ON_LINUX =

ifeq ($(OS_NAME), linux)
WRAP_SYMBOLS_ON_LINUX = -Wl,--wrap=fcntl -Wl,--wrap=fcntl64 -Wl,--wrap=stat64 -Wl,--wrap=pow -Wl,--wrap=exp -Wl,--wrap=log -Wl,--wrap=log2 \
	-Wl,--wrap=lstat \
	-Wl,--wrap=stat \
	-Wl,--wrap=fstat \
	-Wl,--wrap=fstatat \
	-Wl,--wrap=lstat64 \
	-Wl,--wrap=stat64 \
	-Wl,--wrap=fstat64 \
	-Wl,--wrap=fstatat64 \
	-Wl,--wrap=mknod \
	-Wl,--wrap=mknodat \
	-Wl,--wrap=statx

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
		-l:libatomic.a \
		${STATIC_MUSL_FLAG}  \
		-Wl,-Bsymbolic-functions \
		-fno-semantic-interposition \
		-flto \
		-Wl,--allow-multiple-definition \
		-rdynamic


endif


BUN_LLD_FLAGS_WITHOUT_JSC = $(ARCHIVE_FILES) \
		$(LIBICONV_PATH) \
		$(CLANG_FLAGS) \
		$(DEFAULT_LINKER_FLAGS) \
		$(PLATFORM_LINKER_FLAGS) \
		$(SQLITE_OBJECT) ${ICU_FLAGS}



BUN_LLD_FLAGS = $(BUN_LLD_FLAGS_WITHOUT_JSC) $(WRAP_SYMBOLS_ON_LINUX) $(JSC_FILES) $(BINDINGS_OBJ)
BUN_LLD_FLAGS_DEBUG = $(BUN_LLD_FLAGS_WITHOUT_JSC) $(WRAP_SYMBOLS_ON_LINUX) $(JSC_FILES_DEBUG) $(DEBUG_BINDINGS_OBJ)
BUN_LLD_FLAGS_FAST = $(BUN_LLD_FLAGS_WITHOUT_JSC) $(WRAP_SYMBOLS_ON_LINUX)  $(JSC_FILES_DEBUG) $(BINDINGS_OBJ)

CLANG_VERSION = $(shell $(CC) --version | awk '/version/ {for(i=1; i<=NF; i++){if($$i=="version"){split($$(i+1),v,".");print v[1]}}}')



bun:

npm-install:
	$(NPM_CLIENT) install --ignore-scripts --production

npm-install-dev:
	$(NPM_CLIENT) install
	cd test && $(NPM_CLIENT) install
	cd packages/bun-types && $(NPM_CLIENT) install --production

print-%  : ; @echo $* = $($*)
get-%  : ; @echo $($*)
print-version:
	@echo $(PACKAGE_JSON_VERSION)

# Prevent dependency on libtcc1 so it doesn't do filesystem lookups
TINYCC_CFLAGS= -DTCC_LIBTCC1=\"\0\"

# TinyCC needs to run some compiled code after it's been compiled.
# That means we can't compile for a newer microarchitecture than native
# We compile for an older microarchitecture on x64 to ensure compatibility
.PHONY: tinycc
tinycc:
	cd $(TINYCC_DIR) && \
		make clean && \
		AR=$(AR) $(CCACHE_CC_FLAG) CFLAGS='$(CFLAGS_WITHOUT_MARCH) $(NATIVE_OR_OLD_MARCH) -mtune=native $(TINYCC_CFLAGS)' ./configure --enable-static --cc=$(CCACHE_CC_OR_CC) --ar=$(AR) --config-predefs=yes  && \
		make libtcc.a -j10 && \
		cp $(TINYCC_DIR)/*.a $(BUN_DEPS_OUT_DIR)

PYTHON=$(shell which python 2>/dev/null || which python3 2>/dev/null || which python2 2>/dev/null)

.PHONY: esm
js: # to rebundle js (rebuilding binary not needed to reload js code)
	NODE_ENV=production bun src/js/_codegen/index.ts

esm-debug:
	BUN_DEBUG_QUIET_LOGS=1 NODE_ENV=production bun-debug src/js/build-esm.ts

BUN_TYPES_REPO_PATH ?= $(realpath packages/bun-types)

ifeq ($(DEBUG),true)
BUN_RELEASE_BIN = bun
endif

.PHONY: c-ares
c-ares:
	rm -rf $(BUN_DEPS_DIR)/c-ares/build && \
	mkdir $(BUN_DEPS_DIR)/c-ares/build && \
	cd $(BUN_DEPS_DIR)/c-ares/build && \
    cmake $(CMAKE_FLAGS) -DCMAKE_C_FLAGS="$(CFLAGS) -flto=full" \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_LIBDIR=lib \
        -DCARES_STATIC=ON -DCARES_STATIC_PIC=ON -DCARES_SHARED=OFF \
        -G "Ninja" .. && \
	ninja && cp lib/libcares.a $(BUN_DEPS_OUT_DIR)/libcares.a

.PHONY: prepare-types
prepare-types:
	BUN_VERSION=$(PACKAGE_JSON_VERSION) $(BUN_RELEASE_BIN) $(BUN_TYPES_REPO_PATH)/scripts/bundle.ts $(BUN_TYPES_REPO_PATH)/dist
	echo "Generated types for $(PACKAGE_JSON_VERSION) in $(BUN_TYPES_REPO_PATH)/dist"
	cp $(BUN_TYPES_REPO_PATH)/dist/types.d.ts /tmp/bun-types.d.ts
	cd /tmp && $(PACKAGE_DIR)/../../node_modules/.bin/tsc /tmp/bun-types.d.ts

release-types:
	# can be removed when/if "bun publish" is implemented
	@npm --version >/dev/null 2>&1 || (echo -e "ERROR: npm is required."; exit 1)
	cd $(BUN_TYPES_REPO_PATH)/dist && npm publish --dry-run

.PHONY: format
format: ## to format the code
	-$(PRETTIER) --write 'test/**/*.{js,jsx,ts,tsx}'


.PHONY: lolhtml
lolhtml:
	cd $(BUN_DEPS_DIR)/lol-html/ && cd $(BUN_DEPS_DIR)/lol-html/c-api && cargo build --release && cp target/release/liblolhtml.a $(BUN_DEPS_OUT_DIR)

# no asm is not worth it!!
.PHONY: boringssl-build
boringssl-build:
	cd $(BUN_DEPS_DIR)/boringssl && mkdir -p build && cd build && CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=lld" -GNinja .. && ninja libcrypto.a libssl.a libdecrepit.a

.PHONY: boringssl-build-debug
boringssl-build-debug:
	cd $(BUN_DEPS_DIR)/boringssl && mkdir -p build && cd build && CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS_WITHOUT_RELEASE) -DCMAKE_EXE_LINKER_FLAGS="-fuse-ld=lld" -GNinja .. && ninja

boringssl-copy:
	cp $(BUN_DEPS_DIR)/boringssl/build/ssl/libssl.a $(BUN_DEPS_OUT_DIR)/libssl.a
	cp $(BUN_DEPS_DIR)/boringssl/build/crypto/libcrypto.a $(BUN_DEPS_OUT_DIR)/libcrypto.a
	cp $(BUN_DEPS_DIR)/boringssl/build/decrepit/libdecrepit.a $(BUN_DEPS_OUT_DIR)/libdecrepit.a

.PHONY: boringssl
boringssl: boringssl-build boringssl-copy
.PHONY: boringssl-debug
boringssl-debug: boringssl-build-debug boringssl-copy

.PHONY: compile-ffi-test
compile-ffi-test:
	clang $(OPTIMIZATION_LEVEL) -shared -undefined dynamic_lookup -o /tmp/bun-ffi-test.dylib -fPIC ./test/js/bun/ffi/ffi-test.c

sqlite:

.PHONY: zstd
zstd:
	cd $(BUN_DEPS_DIR)/zstd && rm -rf build-cmake-debug && cmake $(CMAKE_FLAGS) -DZSTD_BUILD_STATIC=ON -B build-cmake-debug -S build/cmake -G Ninja && ninja -C build-cmake-debug && cp build-cmake-debug/lib/libzstd.a $(BUN_DEPS_OUT_DIR)/libzstd.a

.PHONY: libarchive
libarchive:
	cd $(BUN_DEPS_DIR)/libarchive; \
	(make clean || echo ""); \
	(./build/clean.sh || echo ""); \
	./build/autogen.sh; \
	CFLAGS="$(CFLAGS)" $(CCACHE_CC_FLAG) ./configure --disable-shared --enable-static  --with-pic  --disable-bsdtar   --disable-bsdcat --disable-rpath --enable-posix-regex-lib  --without-xml2  --without-expat --without-openssl  --without-iconv --without-zlib; \
	make -j${CPUS}; \
	cp ./.libs/libarchive.a $(BUN_DEPS_OUT_DIR)/libarchive.a;

.PHONY: tgz
tgz:
	$(ZIG) build tgz-obj -Doptimize=ReleaseFast
	$(CXX) $(PACKAGE_DIR)/tgz.o -g -o ./misctools/tgz $(DEFAULT_LINKER_FLAGS) -lc  $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/tgz.o

.PHONY: tgz-debug
tgz-debug:
	$(ZIG) build tgz-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/tgz.o -g -o ./misctools/tgz $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(DEBUG_PACKAGE_DIR)/tgz.o

zlib:
	cd $(BUN_DEPS_DIR)/zlib; make clean; $(CCACHE_CC_FLAG) CFLAGS="$(CFLAGS)" ./configure --static && make -j${CPUS} && cp ./libz.a $(BUN_DEPS_OUT_DIR)/libz.a

ifeq ($(POSIX_PKG_MANAGER), brew)
PKGNAME_NINJA := ninja
else
PKGNAME_NINJA := ninja-build
endif

.PHONY: assert-deps
assert-deps:
	@echo "Checking if the required utilities are available..."
	@if [ $(CLANG_VERSION) -lt "18" ]; then echo -e "ERROR: clang version >=18 required, found: $(CLANG_VERSION). Install with:\n\n    $(POSIX_PKG_MANAGER) install llvm@18"; exit 1; fi
	@cmake --version >/dev/null 2>&1 || (echo -e "ERROR: cmake is required."; exit 1)
	@$(PYTHON) --version >/dev/null 2>&1 || (echo -e "ERROR: python is required."; exit 1)
	@$(ESBUILD) --version >/dev/null 2>&1 || (echo -e "ERROR: esbuild is required."; exit 1)
	@$(NPM_CLIENT) --version >/dev/null 2>&1 || (echo -e "ERROR: NPM client (bun or npm) is required."; exit 1)
	@go version >/dev/null 2>&1 || (echo -e "ERROR: go is required."; exit 1)
	@which aclocal > /dev/null || (echo -e  "ERROR: automake is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install automake"; exit 1)
	@which $(LIBTOOL) > /dev/null || (echo -e "ERROR: libtool is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install libtool"; exit 1)
	@which ninja > /dev/null || (echo -e "ERROR: Ninja is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install $(PKGNAME_NINJA)"; exit 1)
	@which pkg-config > /dev/null || (echo -e "ERROR: pkg-config is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install pkg-config"; exit 1)
	@which rustc > /dev/null || (echo -e "ERROR: rustc is required." exit 1)
	@which cargo > /dev/null || (echo -e "ERROR: cargo is required." exit 1)
	@test $(shell cargo --version | awk '{print $$2}' | cut -d. -f2) -gt 57 || (echo -e "ERROR: cargo version must be at least 1.57."; exit 1)
	@echo "You have the dependencies installed! Woo"


.PHONY: init-submodules
init-submodules: submodule # (backwards-compatibility alias)


.PHONY: build-obj
build-obj:
	$(ZIG) build obj -Doptimize=ReleaseFast -Dcpu="$(CPU_TARGET)"

.PHONY: build-obj-small
build-obj-small:
	$(ZIG) build obj -Doptimize=ReleaseSmall -Dcpu="$(CPU_TARGET)"

.PHONY: dev-build-obj-wasm
dev-build-obj-wasm:
	$(ZIG) build bun-wasm -Dtarget=wasm32-freestanding

.PHONY: dev-wasm
dev-wasm: dev-build-obj-wasm
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init', '_getTests']" \
		-g2 -s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/$(MIMALLOC_FILE).wasm  \
		packages/debug-bun-freestanding-wasm32/bun-wasm.o --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/debug-bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/debug-bun-freestanding-wasm32/bun-wasm.wasm packages/bun-wasm/bun.wasm

.PHONY: build-obj-wasm
build-obj-wasm:
	$(ZIG) build bun-wasm -Doptimize=ReleaseFast -Dtarget=wasm32-freestanding
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init', '_getTests']" \
		-s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/$(MIMALLOC_FILE).wasm  \
		packages/bun-freestanding-wasm32/bun-wasm.o $(OPTIMIZATION_LEVEL) --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/bun-freestanding-wasm32/bun-wasm.wasm packages/bun-wasm/bun.wasm

.PHONY: build-obj-wasm-small
build-obj-wasm-small:
	$(ZIG) build bun-wasm -Doptimize=ReleaseFast -Dtarget=wasm32-freestanding
	emcc -sEXPORTED_FUNCTIONS="['_bun_free', '_cycleStart', '_cycleEnd', '_bun_malloc', '_scan', '_transform', '_init', '_getTests']" \
		-Oz -s ERROR_ON_UNDEFINED_SYMBOLS=0  -DNDEBUG  \
		$(BUN_DEPS_DIR)/$(MIMALLOC_FILE).wasm  \
		packages/bun-freestanding-wasm32/bun-wasm.o -Oz --no-entry --allow-undefined  -s ASSERTIONS=0  -s ALLOW_MEMORY_GROWTH=1 -s WASM_BIGINT=1  \
		-o packages/bun-freestanding-wasm32/bun-wasm.wasm
	cp packages/bun-freestanding-wasm32/bun-wasm.wasm packages/bun-wasm/bun.wasm

.PHONY: wasm
wasm: api mimalloc-wasm build-obj-wasm-small
	@rm -rf packages/bun-wasm/*.{d.ts,d.cts,d.mts,js,wasm,cjs,mjs,tsbuildinfo}
	@cp packages/bun-freestanding-wasm32/bun-wasm.wasm packages/bun-wasm/bun.wasm
	@cp src/api/schema.d.ts packages/bun-wasm/schema.d.ts
	@cp src/api/schema.js packages/bun-wasm/schema.js
	@cd packages/bun-wasm && $(NPM_CLIENT) run tsc -- -p .
	@cp packages/bun-wasm/index.d.ts packages/bun-wasm/index.d.cts
	@mv packages/bun-wasm/index.d.ts packages/bun-wasm/index.d.mts
	@bun build --sourcemap=external --external=fs --outdir=packages/bun-wasm --target=browser --minify ./packages/bun-wasm/index.ts
	@mv packages/bun-wasm/index.js packages/bun-wasm/index.mjs
	@mv packages/bun-wasm/index.js.map packages/bun-wasm/index.mjs.map
	@$(ESBUILD) --sourcemap=external --external:fs --outdir=packages/bun-wasm --target=esnext --bundle packages/bun-wasm/index.ts --format=cjs --minify --platform=node 2> /dev/null
	@mv packages/bun-wasm/index.js packages/bun-wasm/index.cjs
	@mv packages/bun-wasm/index.js.map packages/bun-wasm/index.cjs.map
	@rm -rf packages/bun-wasm/*.tsbuildinfo
	@wasm-opt -O4 --enable-mutable-globals  packages/bun-wasm/bun.wasm -o /tmp/bun.wasm
	@mv /tmp/bun.wasm packages/bun-wasm/bun.wasm

.PHONY: build-obj-safe
build-obj-safe:
	$(ZIG) build obj -Doptimize=ReleaseSafe -Dcpu="$(CPU_TARGET)"

UWS_CC_FLAGS = -pthread  -DLIBUS_USE_OPENSSL=1 -DUWS_HTTPRESPONSE_NO_WRITEMARK=1 -DLIBUS_USE_BORINGSSL=1 -DWITH_BORINGSSL=1 -Wpedantic -Wall -Wextra -Wsign-conversion -Wconversion $(UWS_INCLUDE) -DUWS_WITH_PROXY
UWS_CXX_FLAGS = $(UWS_CC_FLAGS) -std=$(CXX_VERSION) -fno-exceptions -fno-rtti
UWS_LDFLAGS = -I$(BUN_DEPS_DIR)/boringssl/include -I$(ZLIB_INCLUDE_DIR)
USOCKETS_DIR = $(BUN_DIR)/packages/bun-usockets
USOCKETS_SRC_DIR = $(USOCKETS_DIR)/src


LSHPACK_SRC_DIR = $(BUN_DEPS_DIR)/ls-hpack
LSHPACK_CC_FLAGS = -DXXH_HEADER_NAME="<xxhash.h>"
LSHPACK_LDFLAGS = -I$(LSHPACK_SRC_DIR) -I$(LSHPACK_SRC_DIR)/deps/xxhash

lshpack:
	rm -rf $(LSHPACK_SRC_DIR)/*.i $(LSHPACK_SRC_DIR)/*.bc $(LSHPACK_SRC_DIR)/*.o $(LSHPACK_SRC_DIR)/*.s $(LSHPACK_SRC_DIR)/*.ii $(LSHPACK_SRC_DIR)/*.s
	cd $(LSHPACK_SRC_DIR) && $(CC_WITH_CCACHE) -I$(LSHPACK_SRC_DIR)  -fno-builtin-malloc -fno-builtin-free -fno-builtin-realloc $(EMIT_LLVM_FOR_RELEASE)  $(MACOS_MIN_FLAG) -fPIC $(CFLAGS) $(LSHPACK_CC_FLAGS) -save-temps -I$(BUN_DEPS_DIR)/uws/lshpack/src $(LSHPACK_LDFLAGS) -g $(DEFAULT_LINKER_FLAGS) $(PLATFORM_LINKER_FLAGS) $(OPTIMIZATION_LEVEL) -c $(wildcard $(LSHPACK_SRC_DIR)/lshpack.c) $(wildcard $(LSHPACK_SRC_DIR)/deps/**/*.c)
	cd $(LSHPACK_SRC_DIR) && $(AR) rcvs $(BUN_DEPS_OUT_DIR)/liblshpack.a $(LSHPACK_SRC_DIR)/*.{o,bc}

usockets:
	rm -rf $(USOCKETS_DIR)/*.i $(USOCKETS_DIR)/*.bc $(USOCKETS_DIR)/*.o $(USOCKETS_DIR)/*.s $(USOCKETS_DIR)/*.ii $(USOCKETS_DIR)/*.s  $(BUN_DEPS_OUT_DIR)/libusockets.a
	cd $(USOCKETS_DIR) && $(CC_WITH_CCACHE) -I$(USOCKETS_SRC_DIR)  -fno-builtin-malloc -fno-builtin-free -fno-builtin-realloc $(EMIT_LLVM_FOR_RELEASE)  $(MACOS_MIN_FLAG) -fPIC $(CFLAGS) $(UWS_CC_FLAGS) -save-temps -I$(BUN_DEPS_DIR)/uws/uSockets/src $(UWS_LDFLAGS) -g $(DEFAULT_LINKER_FLAGS) $(PLATFORM_LINKER_FLAGS) $(OPTIMIZATION_LEVEL) -c $(wildcard $(USOCKETS_SRC_DIR)/*.c) $(wildcard $(USOCKETS_SRC_DIR)/**/*.c)
	cd $(USOCKETS_DIR) && $(CXX_WITH_CCACHE)  -I$(USOCKETS_SRC_DIR) -fno-builtin-malloc -fno-builtin-free -fno-builtin-realloc $(EMIT_LLVM_FOR_RELEASE) $(MACOS_MIN_FLAG)  -fPIC $(CXXFLAGS) $(UWS_CXX_FLAGS) -save-temps -I$(BUN_DEPS_DIR)/uws/uSockets/src $(UWS_LDFLAGS) -g $(DEFAULT_LINKER_FLAGS) $(PLATFORM_LINKER_FLAGS) $(OPTIMIZATION_LEVEL)  -c $(wildcard $(USOCKETS_SRC_DIR)/*.cpp) $(wildcard $(USOCKETS_SRC_DIR)/**/*.cpp)
	cd $(USOCKETS_DIR) && $(AR) rcvs $(BUN_DEPS_OUT_DIR)/libusockets.a $(USOCKETS_DIR)/*.{o,bc}

uws: usockets
	$(CXX_WITH_CCACHE) -O2 $(EMIT_LLVM_FOR_RELEASE) -fPIC -I$(USOCKETS_SRC_DIR) $(CLANG_FLAGS) $(CFLAGS) $(UWS_CXX_FLAGS) $(UWS_LDFLAGS) $(PLATFORM_LINKER_FLAGS) -c -I$(BUN_DEPS_DIR) $(BUN_DEPS_OUT_DIR)/libusockets.a $(BUN_DEPS_DIR)/libuwsockets.cpp -o $(BUN_DEPS_OUT_DIR)/libuwsockets.o

.PHONY: sign-macos-x64
sign-macos-x64:
	gon sign.macos-x64.json

.PHONY: sign-macos-aarch64
sign-macos-aarch64:
	gon sign.macos-aarch64.json

cls:
	@echo -e "\n\n---\n\n"

jsc-check:
	@ls $(JSC_BASE_DIR)  >/dev/null 2>&1 || (echo -e "Failed to access WebKit build. Please compile the WebKit submodule using the Dockerfile at $(shell pwd)/src/javascript/WebKit/Dockerfile and then copy from /output in the Docker container to $(JSC_BASE_DIR). You can override the directory via JSC_BASE_DIR. \n\n 	DOCKER_BUILDKIT=1 docker build -t bun-webkit $(shell pwd)/vendor/WebKit -f $(shell pwd)/vendor/WebKit/Dockerfile --progress=plain\n\n 	docker container create bun-webkit\n\n 	# Get the container ID\n	docker container ls\n\n 	docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $(JSC_BASE_DIR)" && exit 1)
	@ls $(JSC_INCLUDE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit include directory at $(JSC_INCLUDE_DIR)." && exit 1)
	@ls $(JSC_LIB)  >/dev/null 2>&1 || (echo "Failed to access WebKit lib directory at $(JSC_LIB)." && exit 1)

.PHONY: all-js
all-js: runtime_js fallback_decoder bun_error node-fallbacks

ensure-package-dir:
	mkdir -p $(PACKAGE_DIR)

.PHONY: prerelease
prerelease: npm-install api analytics all-js ensure-package-dir
.PHONY: release-only
release-only: release-bindings build-obj cls bun-link-lld-release bun-link-lld-release-dsym release-bin-entitlements
.PHONY: release-safe-only
release-safe-only: all-js bindings build-obj-safe cls bun-link-lld-release bun-link-lld-release-dsym release-bin-entitlements
.PHONY: release
release: prerelease release-only
.PHONY: release-safe
release-safe: prerelease release-safe-only

.PHONY: fmt-cpp
fmt-cpp:
	cd src/bun.js/bindings && $(CLANG_FORMAT) *.cpp *.h -i

.PHONY: fmt-zig
fmt-zig:
	cd src && $(ZIG) fmt **/*.zig

.PHONY: fmt
fmt: fmt-cpp fmt-zig

.PHONY: api
api:
	./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig
	$(ZIG) fmt src/api/schema.zig

.PHONY: node-fallbacks
node-fallbacks:
	@cd src/node-fallbacks; $(NPM_CLIENT) install; $(NPM_CLIENT) run --silent build


.PHONY: fallback_decoder
fallback_decoder:
	@$(ESBUILD) --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

.PHONY: runtime_js
runtime_js:
	@NODE_ENV=production $(ESBUILD) --define:process.env.NODE_ENV=\"production\" --target=esnext --bundle src/runtime.bun.js --format=esm --platform=node --minify --external:/bun:* > src/runtime.out.js

.PHONY: bun_error
bun_error:
	@cd packages/bun-error; $(NPM_CLIENT) install; $(NPM_CLIENT) run --silent build

.PHONY: generate-install-script
generate-install-script:
	@rm -f $(PACKAGES_REALPATH)/bun/install.js
	@$(ESBUILD) --log-level=error --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" --define:process.env.NODE_ENV="\"production\"" --platform=node  --format=cjs $(PACKAGES_REALPATH)/bun/install.ts > $(PACKAGES_REALPATH)/bun/install.js

.PHONY: fetch
fetch: $(IO_FILES)
	$(ZIG) build -Doptimize=ReleaseFast fetch-obj
	$(CXX) $(PACKAGE_DIR)/fetch.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/fetch $(IO_FILES)  $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/fetch.o

.PHONY: sha
sha:
	$(ZIG) build -Doptimize=ReleaseFast sha-bench-obj
	$(CXX) $(PACKAGE_DIR)/sha.o -I$(BUN_DEPS_DIR) -g $(OPTIMIZATION_LEVEL) -o ./misctools/sha $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/sha.o

.PHONY: fetch-debug
fetch-debug: $(IO_FILES)
	$(ZIG) build fetch-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/fetch.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/fetch $(DEBUG_IO_FILES) $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)

.PHONY: machbench-debug
machbench-debug: $(IO_FILES)
	$(ZIG) build machbench-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/machbench.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/machbench $(DEBUG_IO_FILES) $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)

.PHONY: machbench
machbench: $(IO_FILES)
	$(ZIG) build -Doptimize=ReleaseFast machbench-obj
	$(CXX) $(PACKAGE_DIR)/machbench.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/machbench $(IO_FILES)  $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/machbench.o


.PHONY: httpbench-debug
httpbench-debug: $(IO_FILES)
	$(ZIG) build httpbench-obj
	$(CXX) $(IO_FILES) $(DEBUG_PACKAGE_DIR)/httpbench.o -g -o ./misctools/http_bench  $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)

.PHONY: httpbench-release
httpbench-release: $(IO_FILES)
	$(ZIG) build -Doptimize=ReleaseFast httpbench-obj
	$(CXX) $(PACKAGE_DIR)/httpbench.o -g $(OPTIMIZATION_LEVEL) -o ./misctools/httpbench $(IO_FILES)  $(DEFAULT_LINKER_FLAGS) -lc $(MINIMUM_ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/httpbench.o

.PHONY: check-glibc-version-dependency
check-glibc-version-dependency:
	@objdump -T $(RELEASE_BUN) | ((grep -qe "GLIBC_2.3[0-9]") && { echo "Glibc 2.3X detected, this will break the binary"; exit 1; }) || true

ifeq ($(OS_NAME),darwin)

zig-win32:
	$(ZIG) build -Dtarget=x86_64-windows

# Hardened runtime will not work with debugging
bun-codesign-debug:
	codesign --entitlements $(realpath entitlements.debug.plist) --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict $(DEBUG_BUN)

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


.PHONY: jsc
jsc: jsc-build jsc-copy-headers jsc-bindings
.PHONY: jsc-debug
jsc-debug: jsc-build-debug
.PHONY: jsc-build
jsc-build: $(JSC_BUILD_STEPS)
.PHONY: jsc-build-debug
jsc-build-debug: $(JSC_BUILD_STEPS_DEBUG)
.PHONY: jsc-bindings
jsc-bindings: headers bindings

.PHONY: clone-submodules
clone-submodules:
	git -c submodule."vendor/WebKit".update=none submodule update --init --recursive --depth=1 --progress


.PHONY: headers
headers:
	echo please don't run the headers generator anymore. i don't think it works. 
	echo if you really need it, run make headers2
headers2: 
	rm -f /tmp/build-jsc-headers src/bun.js/bindings/headers.zig
	touch src/bun.js/bindings/headers.zig
	$(ZIG) build headers-obj
	$(CXX) $(PLATFORM_LINKER_FLAGS) $(JSC_FILES_DEBUG) ${ICU_FLAGS} $(BUN_LLD_FLAGS_WITHOUT_JSC)  -g $(DEBUG_BIN)/headers.o -W -o /tmp/build-jsc-headers -lc;
	/tmp/build-jsc-headers
	$(ZIG) translate-c src/bun.js/bindings/headers.h > src/bun.js/bindings/headers.zig
	$(BUN_OR_NODE) misctools/headers-cleaner.js
	$(ZIG) fmt src/bun.js/bindings/headers.zig
	$(CLANG_FORMAT) -i src/bun.js/bindings/ZigGeneratedCode.cpp

.PHONY: jsc-bindings-headers
jsc-bindings-headers: headers

MIMALLOC_OVERRIDE_FLAG ?=


bump:
	expr 0.4.0 + 1 > build-id

.PHONY: identifier-cache
identifier-cache:
	$(ZIG) run src/js_lexer/identifier_data.zig

tag:
	git tag $(BUN_BUILD_TAG)
	git push --tags
	cd ../bun-releases-for-updater && echo $(BUN_BUILD_TAG) > bumper && git add bumper && git commit -m "Update latest release" && git tag $(BUN_BUILD_TAG) && git push

.PHONY: prepare-release
prepare-release: tag release-create

release-create-auto-updater:

.PHONY: release-create
release-create:
	gh release create --title "bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)"
	gh release create --repo=$(BUN_AUTO_UPDATER_REPO) --title "bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)" -n "See https://github.com/oven-sh/bun/releases/tag/$(BUN_BUILD_TAG) for release notes. Using the install script or bun upgrade is the recommended way to install bun. Join bun's Discord to get access https://bun.sh/discord"

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
.PHONY: release-bin-generate-zip
release-bin-generate-zip:
	dot_clean -vnm  $(BUN_DEPLOY_DIR)/bun-$(TRIPLET)
	cd $(BUN_DEPLOY_DIR)/bun-$(TRIPLET) && \
		codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvvv --deep --strict bun
	ditto -ck --rsrc --sequesterRsrc --keepParent $(BUN_DEPLOY_DIR)/bun-$(TRIPLET) $(BUN_DEPLOY_ZIP)

.PHONY: release-bin-codesign
release-bin-codesign:
	xcrun notarytool submit --wait $(BUN_DEPLOY_ZIP) --keychain-profile "bun"

else

.PHONY: release-bin-generate-zip
release-bin-generate-zip:
	cd $(BUN_DEPLOY_DIR)/ && zip -r bun-$(TRIPLET).zip bun-$(TRIPLET)

endif


BUN_DEPLOY_ZIP = $(BUN_DEPLOY_DIR)/bun-$(TRIPLET).zip
BUN_DEPLOY_DSYM = $(BUN_DEPLOY_DIR)/bun-$(TRIPLET).dSYM.tar.gz


ifeq ($(OS_NAME),darwin)

.PHONY: release-bin-generate-copy-dsym
release-bin-generate-copy-dsym:
	cd $(shell dirname $(BUN_RELEASE_BIN)) && tar -czvf $(shell basename $(BUN_DEPLOY_DSYM)) $(shell basename $(BUN_RELEASE_BIN)).dSYM && \
	mv $(shell basename $(BUN_DEPLOY_DSYM)) $(BUN_DEPLOY_DSYM)

endif

ifeq ($(OS_NAME),linux)
release-bin-generate-copy-dsym:
endif

.PHONY: release-bin-generate-copy
release-bin-generate-copy:
	rm -rf $(BUN_DEPLOY_DIR)/bun-$(TRIPLET) $(BUN_DEPLOY_ZIP)
	mkdir -p $(BUN_DEPLOY_DIR)/bun-$(TRIPLET)
	cp $(BUN_RELEASE_BIN) $(BUN_DEPLOY_DIR)/bun-$(TRIPLET)/bun

.PHONY: release-bin-generate
release-bin-generate: release-bin-generate-copy release-bin-generate-zip release-bin-generate-copy-dsym

.PHONY: release-bin-check-version
release-bin-check-version:
	test $(shell eval $(BUN_RELEASE_BIN) --version) = $(PACKAGE_JSON_VERSION)

.PHONY: release-bin-check
release-bin-check: release-bin-check-version

ifeq ($(OS_NAME),linux)

.PHONY: release-bin-check
release-bin-check: release-bin-check-version
# force it to run
	@make -B check-glibc-version-dependency
endif

.PHONY: release-bin-push-bin
release-bin-push-bin:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP) --repo $(BUN_AUTO_UPDATER_REPO)


ifeq ($(OS_NAME),darwin)
.PHONY: release-bin-push-dsym
release-bin-push-dsym:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM) --repo $(BUN_AUTO_UPDATER_REPO)
endif

ifeq ($(OS_NAME),linux)
release-bin-push-dsym:
endif

TINYCC_DIR ?= $(realpath $(BUN_DEPS_DIR)/tinycc)

.PHONY: release-bin-push
release-bin-push: release-bin-push-bin release-bin-push-dsym
.PHONY: generate-release-bin-as-zip
generate-release-bin-as-zip: release-bin-generate release-bin-codesign
.PHONY: release-bin-without-push
release-bin-without-push: test-all release-bin-check generate-release-bin-as-zip

.PHONY: release-bin
release-bin: release-bin-without-push release-bin-push

test/wiptest/run.o: test/wiptest/run.cpp
	$(CXX) -Wall -g -c -std=c++2a -lc -o test/wiptest/run.o test/wiptest/run.cpp

test/wiptest/run: test/wiptest/run.o
	$(CXX) -Wall -g -o test/wiptest/run test/wiptest/run.o

release-bin-dir:
	echo $(PACKAGE_DIR)


.PHONY: dev-obj-track
dev-obj-track:
	bun .scripts/make-dev-timer.ts $(ZIG) build obj -freference-trace -Dcpu="$(CPU_TARGET)"

.PHONY: dev-obj-notrack
dev-obj-notrack:
	$(ZIG) build obj -freference-trace -Dcpu="$(CPU_TARGET)"


.PHONY: dev-obj
dev-obj:

ifeq ($(shell which bun),)
dev-obj : dev-obj-notrack
else
dev-obj : dev-obj-track
endif


.PHONY: dev-obj-linux
dev-obj-linux:
	$(ZIG) build obj -Dtarget=x86_64-linux-gnu -Dcpu="$(CPU_TARGET)"

mkdir-dev:
	mkdir -p $(DEBUG_PACKAGE_DIR)

test-all:
	$(RELEASE_BUN) test

.PHONY: copy-test-node-modules
copy-test-node-modules:
	rm -rf test/snippets/package-json-exports/node_modules || echo "";
	cp -r test/snippets/package-json-exports/_node_modules_copy test/snippets/package-json-exports/node_modules || echo "";

.PHONY: kill-bun
kill-bun:
	-killall -9 bun bun-debug

jsc-copy-headers:
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/heap/WeakHandleOwner.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/WeakHandleOwner.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyClassStructureInlines.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyClassStructureInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyPropertyInlines.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyPropertyInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayViewPrototype.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayViewPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayPrototypes.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayPrototypes.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSModuleNamespaceObject.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSModuleNamespaceObject.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JIT.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JIT.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubInfo.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubInfo.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AccessCase.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AccessCase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/ObjectPropertyConditionSet.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ObjectPropertyConditionSet.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/PolyProtoAccessChain.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/PolyProtoAccessChain.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/InlineCacheCompiler.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/InlineCacheCompiler.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubClearingWatchpoint.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubClearingWatchpoint.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AdaptiveInferredPropertyValueWatchpointBase.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AdaptiveInferredPropertyValueWatchpointBase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StubInfoSummary.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StubInfoSummary.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/CommonSlowPaths.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/CommonSlowPaths.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/DirectArguments.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DirectArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GenericArguments.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GenericArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/SamplingProfiler.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SamplingProfiler.h
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
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/dfg/DFGAbstractHeap.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DFGAbstractHeap.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/OperandsInlines.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/OperandsInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/Operands.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/Operands.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/domjit/DOMJITHeapRange.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DOMJITHeapRange.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GeneratorPrototype.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GeneratorFunctionPrototype.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorFunctionPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/AsyncFunctionPrototype.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AsyncFunctionPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/SymbolObject.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SymbolObject.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSGenerator.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/UnlinkedFunctionCodeBlock.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/UnlinkedFunctionCodeBlock.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/AggregateError.h $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AggregateError.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/API/JSWeakValue.h  $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSWeakValue.h
	find $(WEBKIT_RELEASE_DIR)/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

jsc-copy-headers-debug:
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/heap/WeakHandleOwner.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/WeakHandleOwner.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyClassStructureInlines.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyClassStructureInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/LazyPropertyInlines.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LazyPropertyInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayViewPrototype.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayViewPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSTypedArrayPrototypes.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSTypedArrayPrototypes.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSModuleNamespaceObject.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSModuleNamespaceObject.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JIT.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JIT.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubInfo.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubInfo.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AccessCase.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AccessCase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/ObjectPropertyConditionSet.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ObjectPropertyConditionSet.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/PolyProtoAccessChain.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/PolyProtoAccessChain.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/InlineCacheCompiler.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/InlineCacheCompiler.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StructureStubClearingWatchpoint.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StructureStubClearingWatchpoint.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/AdaptiveInferredPropertyValueWatchpointBase.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AdaptiveInferredPropertyValueWatchpointBase.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/StubInfoSummary.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/StubInfoSummary.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/CommonSlowPaths.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/CommonSlowPaths.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/DirectArguments.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DirectArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GenericArguments.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GenericArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/SamplingProfiler.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SamplingProfiler.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/ScopedArguments.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ScopedArguments.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSLexicalEnvironment.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSLexicalEnvironment.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITDisassembler.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITDisassembler.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITInlineCacheGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITInlineCacheGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMathIC.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathIC.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITAddGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITAddGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMathICInlineResult.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMathICInlineResult.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/SnippetOperand.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SnippetOperand.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITMulGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITMulGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITNegGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITNegGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITSubGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITSubGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/Repatch.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/Repatch.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITRightShiftGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITRightShiftGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JITBitBinaryOpGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JITBitBinaryOpGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/jit/JSInterfaceJIT.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSInterfaceJIT.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/llint/LLIntData.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/LLIntData.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/FunctionCodeBlock.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/FunctionCodeBlock.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/dfg/DFGAbstractHeap.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DFGAbstractHeap.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/OperandsInlines.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/OperandsInlines.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/Operands.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/Operands.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/domjit/DOMJITHeapRange.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/DOMJITHeapRange.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GeneratorPrototype.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/GeneratorFunctionPrototype.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/GeneratorFunctionPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/AsyncFunctionPrototype.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AsyncFunctionPrototype.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/SymbolObject.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/SymbolObject.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/JSGenerator.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSGenerator.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/bytecode/UnlinkedFunctionCodeBlock.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/UnlinkedFunctionCodeBlock.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/runtime/AggregateError.h $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/AggregateError.h
	cp $(WEBKIT_DIR)/Source/JavaScriptCore/API/JSWeakValue.h  $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSWeakValue.h
	find $(WEBKIT_DEBUG_DIR)/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} $(WEBKIT_DEBUG_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

# This is a workaround for a JSC bug that impacts aarch64
# on macOS, it never requests JIT permissions
.PHONY: jsc-force-fastjit
jsc-force-fastjit:
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/assembler/FastJITPermissions.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.cpp

.PHONY: jsc-build-mac-compile
jsc-build-mac-compile:
	mkdir -p $(WEBKIT_RELEASE_DIR) $(WEBKIT_DIR);
	cd $(WEBKIT_RELEASE_DIR) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON \
			-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
			-DCMAKE_BUILD_TYPE=RelWithDebInfo \
			-DUSE_THIN_ARCHIVES=OFF \
			-DBUN_FAST_TLS=ON \
			-DENABLE_FTL_JIT=ON \
			-DUSE_BUN_JSC_ADDITIONS=ON \
			-DUSE_BUN_EVENT_LOOP=ON \
			-G Ninja \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR) && \
	CFLAGS="$(CFLAGS) -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS)  -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config RelWithDebInfo --target jsc

.PHONY: jsc-build-mac-compile-lto
jsc-build-mac-compile-lto:
	mkdir -p $(WEBKIT_RELEASE_DIR_LTO) $(WEBKIT_DIR);
	cd $(WEBKIT_RELEASE_DIR_LTO) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DENABLE_SINGLE_THREADED_VM_ENTRY_SCOPE=ON \
			-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
			-DCMAKE_BUILD_TYPE=Release \
			-DUSE_THIN_ARCHIVES=OFF \
			-DBUN_FAST_TLS=ON \
			-DUSE_BUN_JSC_ADDITIONS=ON \
			-DUSE_BUN_EVENT_LOOP=ON \
			-DCMAKE_C_FLAGS="-flto=full" \
			-DCMAKE_CXX_FLAGS="-flto=full" \
			-DENABLE_FTL_JIT=ON \
			-G Ninja \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR_LTO) && \
	CFLAGS="$(CFLAGS) -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR_LTO) --config Release --target jsc

.PHONY: jsc-build-mac-compile-debug
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
			-DENABLE_MALLOC_HEAP_BREAKDOWN=ON \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-DUSE_BUN_JSC_ADDITIONS=ON \
			-DUSE_BUN_EVENT_LOOP=ON \
			-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON \
			-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
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

.PHONY: jsc-build-linux-compile-config
jsc-build-linux-compile-config:
	mkdir -p $(WEBKIT_RELEASE_DIR)
	cd $(WEBKIT_RELEASE_DIR) && \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=Debug \
			-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON \
			-DUSE_THIN_ARCHIVES=OFF \
			-DUSE_BUN_JSC_ADDITIONS=ON \
			-DUSE_BUN_EVENT_LOOP=ON \
			-DENABLE_FTL_JIT=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			-DJSEXPORT_PRIVATE=WTF_EXPORT_DECLARATION \
			-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
			-USE_VISIBILITY_ATTRIBUTE=1 \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			-DCMAKE_CXX_COMPILER=$(CXX) \
			-DCMAKE_C_COMPILER=$(CC) \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR)

.PHONY: jsc-build-linux-compile-config-debug
jsc-build-linux-compile-config-debug:
	mkdir -p $(WEBKIT_DEBUG_DIR)
	cd $(WEBKIT_DEBUG_DIR) && \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=Debug \
			-DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON \
			-DUSE_THIN_ARCHIVES=OFF \
			-DUSE_BUN_JSC_ADDITIONS=ON \
			-DUSE_BUN_EVENT_LOOP=ON \
			-DENABLE_FTL_JIT=ON \
			-DENABLE_REMOTE_INSPECTOR=ON \
			-DJSEXPORT_PRIVATE=WTF_EXPORT_DECLARATION \
			-DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON \
			-USE_VISIBILITY_ATTRIBUTE=1 \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			-DCMAKE_CXX_COMPILER=$(CXX) \
			-DCMAKE_C_COMPILER=$(CC) \
			$(WEBKIT_DIR) \
			$(WEBKIT_DEBUG_DIR)

# If you get "Error: could not load cache"
# run  rm -rf vendor/WebKit/CMakeCache.txt
.PHONY: jsc-build-linux-compile-build
jsc-build-linux-compile-build:
		mkdir -p $(WEBKIT_RELEASE_DIR)  && \
		cd $(WEBKIT_RELEASE_DIR)  && \
	CFLAGS="$(CFLAGS) -Wl,--whole-archive -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -Wl,--whole-archive -ffat-lto-objects -DUSE_BUN_JSC_ADDITIONS=ON -DUSE_BUN_EVENT_LOOP=ON" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config relwithdebuginfo --target jsc

.PHONY: jsc-build-linux-compile-build-debug
jsc-build-linux-compile-build-debug:
		mkdir -p $(WEBKIT_DEBUG_DIR)  && \
		cd $(WEBKIT_DEBUG_DIR)  && \
	CFLAGS="$(CFLAGS) -Wl,--whole-archive -ffat-lto-objects" CXXFLAGS="$(CXXFLAGS) -Wl,--whole-archive -ffat-lto-objects -DUSE_BUN_JSC_ADDITIONS=ON -DUSE_BUN_EVENT_LOOP=ON" \
		cmake --build $(WEBKIT_DEBUG_DIR) --config Debug --target jsc


jsc-build-mac: jsc-force-fastjit jsc-build-mac-compile jsc-build-copy
jsc-build-mac-debug: jsc-force-fastjit jsc-build-mac-compile-debug

jsc-build-linux: jsc-build-linux-compile-config jsc-build-linux-compile-build jsc-build-copy
jsc-build-linux-debug: jsc-build-linux-compile-config-debug jsc-build-linux-compile-build-debug

jsc-build-copy:
	cp $(WEBKIT_RELEASE_DIR)/lib/libJavaScriptCore.a $(BUN_DEPS_OUT_DIR)/libJavaScriptCore.a
	#cp $(WEBKIT_RELEASE_DIR)/lib/libLowLevelInterpreterLib.a $(BUN_DEPS_OUT_DIR)/libLowLevelInterpreterLib.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libWTF.a $(BUN_DEPS_OUT_DIR)/libWTF.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libbmalloc.a $(BUN_DEPS_OUT_DIR)/libbmalloc.a

jsc-build-copy-debug:
	cp $(WEBKIT_DEBUG_DIR)/lib/libJavaScriptCore.a $(BUN_DEPS_OUT_DIR)/libJavaScriptCore.a
	#cp $(WEBKIT_DEBUG_DIR)/lib/libLowLevelInterpreterLib.a $(BUN_DEPS_OUT_DIR)/libLowLevelInterpreterLib.a
	cp $(WEBKIT_DEBUG_DIR)/lib/libWTF.a $(BUN_DEPS_OUT_DIR)/libWTF.a
	cp $(WEBKIT_DEBUG_DIR)/lib/libbmalloc.a $(BUN_DEPS_OUT_DIR)/libbmalloc.a

clean-jsc:
	cd vendor/WebKit && rm -rf **/CMakeCache.txt **/CMakeFiles && rm -rf vendor/WebKit/WebKitBuild
clean-bindings:
	rm -rf $(OBJ_DIR)/*.o $(DEBUG_OBJ_DIR)/*.o $(DEBUG_OBJ_DIR)/webcore/*.o $(DEBUG_BINDINGS_OBJ) $(OBJ_DIR)/webcore/*.o $(BINDINGS_OBJ) $(OBJ_DIR)/*.d $(DEBUG_OBJ_DIR)/*.d

.PHONY: clean
clean: clean-bindings
	rm $(BUN_DEPS_DIR)/*.a $(BUN_DEPS_DIR)/*.o
	(cd $(BUN_DEPS_DIR)/mimalloc && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/libarchive && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/boringssl && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/picohttp && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/zlib && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/c-ares && rm -rf build && make clean) || echo "";

.PHONY: release-bindings
release-bindings: $(OBJ_DIR) $(OBJ_FILES) $(WEBCORE_OBJ_FILES) $(SQLITE_OBJ_FILES) $(NODE_OS_OBJ_FILES) $(BUILTINS_OBJ_FILES) $(IO_FILES) $(MODULES_OBJ_FILES) $(WEBCRYPTO_OBJ_FILES)

# Do not add $(DEBUG_DIR) to this list
# It will break caching, causing you to have to wait for every .cpp file to rebuild.
.PHONY: bindings
bindings-real: $(DEBUG_OBJ_DIR) $(DEBUG_OBJ_FILES) $(DEBUG_WEBCORE_OBJ_FILES) $(DEBUG_SQLITE_OBJ_FILES) $(DEBUG_NODE_OS_OBJ_FILES) $(DEBUG_BUILTINS_OBJ_FILES) $(DEBUG_IO_FILES) $(DEBUG_MODULES_OBJ_FILES) $(DEBUG_WEBCRYPTO_OBJ_FILES)

.PHONY: jsc-bindings-mac
jsc-bindings-mac: bindings

# lInux only
MIMALLOC_VALGRIND_ENABLED_FLAG =

ifeq ($(OS_NAME),linux)
	MIMALLOC_VALGRIND_ENABLED_FLAG = -DMI_TRACK_VALGRIND=ON
endif


.PHONY: mimalloc-debug
mimalloc-debug:
	rm -rf $(BUN_DEPS_DIR)/mimalloc/CMakeCache* $(BUN_DEPS_DIR)/mimalloc/CMakeFiles
	cd $(BUN_DEPS_DIR)/mimalloc; make clean || echo ""; \
		CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS_WITHOUT_RELEASE) ${MIMALLOC_OVERRIDE_FLAG} ${MIMALLOC_VALGRIND_ENABLED_FLAG} \
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
			-GNinja \
			. \
			&& ninja
	cp $(BUN_DEPS_DIR)/mimalloc/$(_MIMALLOC_DEBUG_FILE) $(BUN_DEPS_OUT_DIR)/$(_MIMALLOC_DEBUG_FILE)


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
			-GNinja \
			 . \
			&& ninja;
	cp $(BUN_DEPS_DIR)/mimalloc/$(MIMALLOC_INPUT_PATH) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)


mimalloc-wasm:
	rm -rf $(BUN_DEPS_DIR)/mimalloc/CMakeCache* $(BUN_DEPS_DIR)/mimalloc/CMakeFiles
	cd $(BUN_DEPS_DIR)/mimalloc; emcmake cmake -DMI_BUILD_SHARED=OFF -DMI_BUILD_STATIC=ON -DMI_BUILD_TESTS=OFF -GNinja -DMI_BUILD_OBJECT=ON ${MIMALLOC_OVERRIDE_FLAG} -DMI_USE_CXX=OFF .; emmake cmake --build .;
	cp $(BUN_DEPS_DIR)/mimalloc/$(MIMALLOC_INPUT_PATH) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE).wasm

# alias for link, incase anyone still types that
.PHONY: bun-link-lld-debug
bun-link-lld-debug: link

.PHONY: link
link: ## link a debug build of bun
	$(CXX) $(BUN_LLD_FLAGS_DEBUG) $(DEBUG_FLAGS) $(SYMBOLS) \
		-g \
		$(DEBUG_BIN)/bun-debug.o \
		-W \
		-o $(DEBUG_BIN)/bun-debug
		@rm -f $(DEBUG_BIN)/bun-debug.o.o 2> /dev/null # workaround for https://github.com/ziglang/zig/issues/14080

link-no-jsc:
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
	mkdir -p $(PACKAGE_DIR)
	cp $(BUN_DEPLOY_DIR).o $(BUN_RELEASE_BIN).o

.PHONY: bun-link-lld-profile profile
bun-link-lld-profile:
	$(CXX) $(BUN_LLD_FLAGS) $(SYMBOLS) -g -gdwarf-4 -fno-omit-frame-pointer \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		$(OPTIMIZATION_LEVEL) $(RELEASE_FLAGS)
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile
	@rm -f $(BUN_RELEASE_BIN).o.o # workaround for https://github.com/ziglang/zig/issues/14080

build-profile: build-obj bun-link-lld-profile bun-codesign-release-local

bun-link-lld-release:
	$(CXX) $(BUN_LLD_FLAGS) $(SYMBOLS) \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		$(OPTIMIZATION_LEVEL) $(RELEASE_FLAGS)
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile
	@rm -f $(BUN_RELEASE_BIN).o.o # workaround for https://github.com/ziglang/zig/issues/14080

bun-release-copy-obj:
	cp $(BUN_RELEASE_BIN).o $(BUN_DEPLOY_DIR).o
	cp $(BUN_RELEASE_BIN).o /tmp/bun-current.o

bun-link-lld-release-no-lto:
	$(CXX) $(BUN_LLD_FLAGS_FAST) $(SYMBOLS) \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		$(OPTIMIZATION_LEVEL) $(RELEASE_FLAGS)
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile


ifeq ($(OS_NAME),darwin)
bun-link-lld-release-dsym: bun-release-copy-obj
	$(DSYMUTIL) -o $(BUN_RELEASE_BIN).dSYM $(BUN_RELEASE_BIN)
	-$(STRIP) $(BUN_RELEASE_BIN)

copy-to-bun-release-dir-dsym:
	gzip --keep -c $(PACKAGE_DIR)/bun.dSYM > $(BUN_RELEASE_DIR)/bun.dSYM.gz
endif

ifeq ($(OS_NAME),linux)
bun-link-lld-release-dsym: bun-release-copy-obj
	mv $(BUN_RELEASE_BIN).o $(BUN_DEPLOY_DIR).o
	-$(STRIP) -s $(BUN_RELEASE_BIN) --wildcard -K _napi\*
copy-to-bun-release-dir-dsym:

endif

bun-relink: bun-relink-copy bun-link-lld-release bun-link-lld-release-dsym
bun-relink-fast: bun-relink-copy bun-link-lld-release-no-lto

wasm-return1:
	$(ZIG) build-lib -OReleaseSmall test/bun.js/wasm-return-1-test.zig -femit-bin=test/bun.js/wasm-return-1-test.wasm -target wasm32-freestanding

generate-classes:
	bun src/codegen/generate-classes.ts
	$(ZIG) fmt src/bun.js/bindings/generated_classes.zig
	$(CLANG_FORMAT) -i src/bun.js/bindings/ZigGeneratedClasses.h src/bun.js/bindings/ZigGeneratedClasses.cpp

generate-sink:
	bun src/codegen/generate-jssink.js
	$(CLANG_FORMAT) -i  src/bun.js/bindings/JSSink.cpp  src/bun.js/bindings/JSSink.h
	./src/bun.js/scripts/create_hash_table src/bun.js/bindings/JSSink.cpp > src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/#include "Lookup.h"//' src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/namespace JSC {//' src/bun.js/bindings/JSSinkLookupTable.h
	$(SED) -i -e 's/} \/\/ namespace JSC//' src/bun.js/bindings/JSSinkLookupTable.h

codegen: generate-sink generate-classes

EMIT_LLVM_FOR_RELEASE=-emit-llvm -flto="full"
EMIT_LLVM_FOR_DEBUG=
EMIT_LLVM=$(EMIT_LLVM_FOR_RELEASE)

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR):
	mkdir -p $(OBJ_DIR)

$(DEBUG_OBJ_DIR):
	mkdir -p $(DEBUG_OBJ_DIR)

$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) $(UWS_INCLUDE) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: src/bun.js/modules/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) $(UWS_INCLUDE) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: $(SRC_DIR)/webcore/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: $(SRC_DIR)/sqlite/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: src/io/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: $(SRC_DIR)/node_os/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

$(OBJ_DIR)/%.o: src/js/out/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<


$(OBJ_DIR)/%.o: src/bun.js/bindings/webcrypto/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM) \
		-c -o $@ $<

# $(DEBUG_OBJ_DIR) is not included here because it breaks
# detecting if a file needs to be rebuilt
.PHONY: $(SRC_DIR)/%.cpp
$(DEBUG_OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) $(UWS_INCLUDE) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		-DBUN_DEBUG \
		$(EMIT_LLVM_FOR_DEBUG) \
		-g3 -c -o $@ $<

# $(DEBUG_OBJ_DIR) is not included here because it breaks
# detecting if a file needs to be rebuilt
.PHONY: $(SRC_DIR)/webcore/%.cpp
$(DEBUG_OBJ_DIR)/%.o: $(SRC_DIR)/webcore/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<

.PHONY: src/io/%.cpp
$(DEBUG_OBJ_DIR)/%.o: src/io/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		-DBUN_DEBUG \
		$(EMIT_LLVM_FOR_DEBUG) \
		-g3 -c -o $@ $<


# $(DEBUG_OBJ_DIR) is not included here because it breaks
# detecting if a file needs to be rebuilt
.PHONY: $(SRC_DIR)/sqlite/%.cpp
$(DEBUG_OBJ_DIR)/%.o: $(SRC_DIR)/sqlite/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<

# $(DEBUG_OBJ_DIR) is not included here because it breaks
# detecting if a file needs to be rebuilt
.PHONY: $(SRC_DIR)/node_os/%.cpp
$(DEBUG_OBJ_DIR)/%.o: $(SRC_DIR)/node_os/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<

# $(DEBUG_OBJ_DIR) is not included here because it breaks
# detecting if a file needs to be rebuilt
.PHONY: src/js/out/builtins/%.cpp
$(DEBUG_OBJ_DIR)/%.o: src/js/out/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<

.PHONY: src/bun.js/modules/%.cpp
$(DEBUG_OBJ_DIR)/%.o: src/bun.js/modules/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<


.PHONY: src/bun.js/bindings/webcrypto/%.cpp
$(DEBUG_OBJ_DIR)/%.o: src/bun.js/bindings/webcrypto/%.cpp
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(DEBUG_OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-I$(SRC_DIR) \
		-fno-rtti \
		-ferror-limit=10 \
		$(EMIT_LLVM_FOR_DEBUG) \
		-DBUN_DEBUG \
		-g3 -c -o $@ $<

sizegen:
	mkdir -p $(BUN_TMP_DIR)
	$(CXX) src/bun.js/headergen/sizegen.cpp -Wl,-dead_strip -Wl,-dead_strip_dylibs -fuse-ld=lld -o $(BUN_TMP_DIR)/sizegen $(CLANG_FLAGS) -O1
	$(BUN_TMP_DIR)/sizegen > src/bun.js/bindings/sizes.zig


# Linux uses bundled SQLite3
ifeq ($(OS_NAME),linux)
sqlite:
	$(CC) $(EMIT_LLVM_FOR_RELEASE) $(CFLAGS) $(INCLUDE_DIRS) -DSQLITE_ENABLE_COLUMN_METADATA= -DSQLITE_MAX_VARIABLE_NUMBER=250000 -DSQLITE_ENABLE_RTREE=1 -DSQLITE_ENABLE_FTS3=1 -DSQLITE_ENABLE_FTS3_PARENTHESIS=1 -DSQLITE_ENABLE_FTS5=1 -DSQLITE_ENABLE_JSON1=1 -DSQLITE_ENABLE_MATH_FUNCTIONS=1 $(SRC_DIR)/sqlite/sqlite3.c -c -o $(SQLITE_OBJECT)
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

.PHONY: build-unit
build-unit: # to build your unit tests
	@rm -rf zig-out/bin/$(testname)
	@mkdir -p zig-out/bin
	$(ZIG) test  $(realpath $(testpath)) \
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

.PHONY: run-all-unit-tests
run-all-unit-tests: # to run your unit tests
	@rm -rf zig-out/bin/__main_test
	@mkdir -p zig-out/bin
	$(ZIG) test src/main.zig \
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

.PHONY: run-unit
run-unit:
	@zig-out/bin/$(testname) $(ZIG)

.PHONY: test
test: build-unit run-unit

.PHONY: integration-test-dev
integration-test-dev: # to run integration tests
	USE_EXISTING_PROCESS=true TEST_SERVER_URL=http://localhost:3000 node test/scripts/browser.js

copy-install:
	cp src/cli/install.sh ../bun.sh/docs/install.html

copy-to-bun-release-dir: copy-to-bun-release-dir-bin copy-to-bun-release-dir-dsym

copy-to-bun-release-dir-bin:
	cp -r $(PACKAGE_DIR)/bun $(BUN_RELEASE_DIR)/bun
	cp -r $(PACKAGE_DIR)/bun-profile $(BUN_RELEASE_DIR)/bun-profile

PACKAGE_MAP = --pkg-begin async_io $(BUN_DIR)/src/io/io_darwin.zig --pkg-begin bun $(BUN_DIR)/src/bun_redirect.zig --pkg-end --pkg-end --pkg-begin javascript_core $(BUN_DIR)/src/jsc.zig --pkg-begin bun $(BUN_DIR)/src/bun_redirect.zig --pkg-end --pkg-end --pkg-begin bun $(BUN_DIR)/src/bun_redirect.zig --pkg-end

.PHONY: cold-jsc-start
cold-jsc-start:
	$(CXX_WITH_CCACHE) $(CLANG_FLAGS) \
		$(MACOS_MIN_FLAG) \
		$(OPTIMIZATION_LEVEL) \
		${MMD_IF_LOCAL} \
		-fno-exceptions \
		-fno-rtti \
		-ferror-limit=10 \
		$(LIBICONV_PATH) \
		$(DEFAULT_LINKER_FLAGS) \
		$(PLATFORM_LINKER_FLAGS) \
		$(ICU_FLAGS) \
		$(JSC_FILES) \
		misctools/cold-jsc-start.cpp -o cold-jsc-start

.PHONY: vendor-without-npm
vendor-without-npm: node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib boringssl libarchive lolhtml sqlite usockets uws lshpack tinycc c-ares zstd


.PHONY: vendor-without-check
vendor-without-check: npm-install vendor-without-npm

.PHONY: vendor
vendor: assert-deps submodule vendor-without-check

.PHONY: vendor-dev
vendor-dev: assert-deps submodule npm-install-dev vendor-without-npm

.PHONY: bun
bun: 
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

cpp:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

zig:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

dev:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

setup:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

bindings:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'

help:
	@echo 'makefile is deprecated - use `cmake` / `bun run build`'
	@echo 'See https://bun.sh/docs/project/contributing for more details'
