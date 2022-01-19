SHELL := /bin/bash # Use bash syntax to be consistent

OS_NAME := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH_NAME_RAW := $(shell uname -m)
BUN_AUTO_UPDATER_REPO = Jarred-Sumner/bun-releases-for-updater

# On Linux ARM64, uname -m reports aarch64
ifeq ($(ARCH_NAME_RAW),aarch64)
ARCH_NAME_RAW = arm64
endif

MIN_MACOS_VERSION = 10.14


MARCH_NATIVE =

ARCH_NAME :=
DOCKER_BUILDARCH =
ifeq ($(ARCH_NAME_RAW),arm64)
   ARCH_NAME = aarch64
   DOCKER_BUILDARCH = arm64
   BREW_PREFIX_PATH = /opt/homebrew
   MIN_MACOS_VERSION = 11.0
else
   ARCH_NAME = x64
   DOCKER_BUILDARCH = amd64
   BREW_PREFIX_PATH = /usr/local
   MARCH_NATIVE = -march=native
endif

TRIPLET = $(OS_NAME)-$(ARCH_NAME)
PACKAGE_NAME = bun-$(TRIPLET)
PACKAGES_REALPATH = $(realpath packages)
PACKAGE_DIR = $(PACKAGES_REALPATH)/$(PACKAGE_NAME)
DEBUG_PACKAGE_DIR = $(PACKAGES_REALPATH)/debug-$(PACKAGE_NAME)
RELEASE_BUN = $(PACKAGE_DIR)/bun
DEBUG_BIN = $(DEBUG_PACKAGE_DIR)/
DEBUG_BUN = $(DEBUG_BIN)/bun-debug
BUILD_ID = $(shell cat ./build-id)
PACKAGE_JSON_VERSION = 0.0.$(BUILD_ID)
BUN_BUILD_TAG = bun-v$(PACKAGE_JSON_VERSION)
BUN_RELEASE_BIN = $(PACKAGE_DIR)/bun
PRETTIER ?= $(shell which prettier || echo "./node_modules/.bin/prettier")
DSYMUTIL ?= $(shell which dsymutil || which dsymutil-13)
WEBKIT_DIR ?= $(realpath src/javascript/jsc/WebKit)
WEBKIT_RELEASE_DIR ?= $(WEBKIT_DIR)/WebKitBuild/Release

NPM_CLIENT ?= $(shell which bun || which npm)
ZIG ?= $(shell which zig || echo -e "error: Missing zig. Please make sure zig is in PATH. Or set ZIG=/path/to-zig-executable")

# We must use the same compiler version for the JavaScriptCore bindings and JavaScriptCore
# If we don't do this, strange memory allocation failures occur.
# This is easier to happen than you'd expect.
# Using realpath here causes issues because clang uses clang++ as a symlink 
# so if that's resolved, it won't build for C++
CC ?= $(shell which clang-13 || which clang)
CXX ?= $(shell which clang++-13 || which clang++)

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


LIBTOOL=libtoolize
ifeq ($(OS_NAME),darwin)
   LIBTOOL=glibtoolize
endif

ifeq ($(OS_NAME),linux)
LIBICONV_PATH = 
endif


CFLAGS = $(MACOS_MIN_FLAG) $(MARCH_NATIVE) -ffunction-sections -fdata-sections -g -O3
BUN_TMP_DIR := /tmp/make-bun
BUN_DEPLOY_DIR = /tmp/bun-v$(PACKAGE_JSON_VERSION)/$(PACKAGE_NAME)

DEFAULT_USE_BMALLOC := 1

USE_BMALLOC ?= DEFAULT_USE_BMALLOC

JSC_BASE_DIR ?= ${HOME}/webkit-build

DEFAULT_JSC_LIB := 

ifeq ($(OS_NAME),linux)
DEFAULT_JSC_LIB = $(JSC_BASE_DIR)/lib
endif

ifeq ($(OS_NAME),darwin)
DEFAULT_JSC_LIB = $(BUN_DEPS_DIR)
endif

JSC_LIB ?= $(DEFAULT_JSC_LIB)

JSC_INCLUDE_DIR ?= $(JSC_BASE_DIR)/include
ZLIB_INCLUDE_DIR ?= $(BUN_DEPS_DIR)/zlib
ZLIB_LIB_DIR ?= $(BUN_DEPS_DIR)/zlib

JSC_FILES := $(JSC_LIB)/libJavaScriptCore.a $(JSC_LIB)/libWTF.a  $(JSC_LIB)/libbmalloc.a

ENABLE_MIMALLOC ?= 1

# https://github.com/microsoft/mimalloc/issues/512
# Linking mimalloc via object file on macOS x64 can cause heap corruption
_MIMALLOC_FILE = libmimalloc.o
_MIMALLOC_INPUT_PATH = CMakeFiles/mimalloc-obj.dir/src/static.c.o

DEFAULT_LINKER_FLAGS =

JSC_BUILD_STEPS :=
ifeq ($(OS_NAME),linux)
	JSC_BUILD_STEPS += jsc-build-linux
DEFAULT_LINKER_FLAGS= -pthread -ldl 
endif
ifeq ($(OS_NAME),darwin)
	JSC_BUILD_STEPS += jsc-build-mac jsc-copy-headers
	_MIMALLOC_FILE = libmimalloc.a
	_MIMALLOC_INPUT_PATH = libmimalloc.a
endif

MIMALLOC_FILE=
MIMALLOC_INPUT_PATH=
MIMALLOC_FILE_PATH=
ifeq ($(ENABLE_MIMALLOC), 1)
MIMALLOC_FILE=$(_MIMALLOC_FILE)
MIMALLOC_FILE_PATH=$(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)
MIMALLOC_INPUT_PATH=$(_MIMALLOC_INPUT_PATH)
endif





MACOSX_DEPLOYMENT_TARGET=$(MIN_MACOS_VERSION)
MACOS_MIN_FLAG=

POSIX_PKG_MANAGER=sudo apt

STRIP ?= $(shell which llvm-strip || which llvm-strip-13 || echo "Missing llvm-strip. Please pass it in the STRIP environment var"; exit 1;)

HOMEBREW_PREFIX ?= $(BREW_PREFIX_PATH)

SRC_DIR := src/javascript/jsc/bindings
OBJ_DIR := src/javascript/jsc/bindings-obj
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
MAC_INCLUDE_DIRS := -I$(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders \
		-I$(WEBKIT_RELEASE_DIR)/WTF/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ICU/Headers \
		-I$(WEBKIT_RELEASE_DIR)/ \
		-Isrc/javascript/jsc/bindings/ \
		-I$(WEBKIT_DIR)/Source/bmalloc 

LINUX_INCLUDE_DIRS := -I$(JSC_INCLUDE_DIR) \
					  -Isrc/javascript/jsc/bindings/

INCLUDE_DIRS :=



ifeq ($(OS_NAME),linux)
	INCLUDE_DIRS += $(LINUX_INCLUDE_DIRS)
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
		-std=gnu++17 \
		-DSTATICALLY_LINKED_WITH_JavaScriptCore=1 \
		-DSTATICALLY_LINKED_WITH_WTF=1 \
		-DSTATICALLY_LINKED_WITH_BMALLOC=1 \
		-DBUILDING_WITH_CMAKE=1 \
		-DNDEBUG=1 \
		-DNOMINMAX \
		-DIS_BUILD \
		-g \
		-DENABLE_INSPECTOR_ALTERNATE_DISPATCHERS=0 \
		-DBUILDING_JSCONLY__ \
		-DASSERT_ENABLED=0 \
		-fvisibility=hidden \
		-fvisibility-inlines-hidden \
		-fno-omit-frame-pointer $(CFLAGS)
		
# This flag is only added to webkit builds on Apple platforms
# It has something to do with ICU
ifeq ($(OS_NAME), darwin)
CLANG_FLAGS += -DDU_DISABLE_RENAMING=1 \
		-lstdc++ \
		-ffunction-sections \
		-fdata-sections \
		-Wl,-no_eh_labels \
		-Wl,-dead_strip \
		-Wl,-dead_strip_dylibs \
		-force_flat_namespace
endif



ARCHIVE_FILES_WITHOUT_LIBCRYPTO = $(MIMALLOC_FILE_PATH) \
		$(BUN_DEPS_OUT_DIR)/libz.a \
		$(BUN_DEPS_OUT_DIR)/libarchive.a \
		$(BUN_DEPS_OUT_DIR)/libssl.a \
		$(BUN_DEPS_OUT_DIR)/picohttpparser.o \
		$(BUN_DEPS_OUT_DIR)/libbacktrace.a

ARCHIVE_FILES = $(ARCHIVE_FILES_WITHOUT_LIBCRYPTO) $(BUN_DEPS_OUT_DIR)/libcrypto.boring.a


PLATFORM_LINKER_FLAGS =

STATIC_MUSL_FLAG ?= 

ifeq ($(OS_NAME), linux)
PLATFORM_LINKER_FLAGS = \
	    -fuse-ld=lld \
		-lc \
		-Wl,-z,now \
		-Wl,--as-needed \
		-Wl,--gc-sections \
		-Wl,-z,stack-size=12800000 \
		-ffunction-sections \
		-fdata-sections \
		-static-libstdc++ \
		-static-libgcc \
		${STATIC_MUSL_FLAG} 
endif

ifeq ($(OS_NAME), darwin)
PLATFORM_LINKER_FLAGS = \
		-Wl,-keep_private_externs 
endif


BUN_LLD_FLAGS = $(OBJ_FILES) \
		${ICU_FLAGS} \
		${JSC_FILES} \
		$(ARCHIVE_FILES) \
		$(LIBICONV_PATH) \
		$(CLANG_FLAGS) \
		$(DEFAULT_LINKER_FLAGS) \
		$(PLATFORM_LINKER_FLAGS)


bun:


vendor-without-check: api analytics node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib boringssl libarchive libbacktrace

boringssl-build:
	cd $(BUN_DEPS_DIR)/boringssl && mkdir -p build && cd build && CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) -GNinja .. && ninja 

boringssl-copy:
	cp $(BUN_DEPS_DIR)/boringssl/build/ssl/libssl.a $(BUN_DEPS_OUT_DIR)/libssl.a
	cp $(BUN_DEPS_DIR)/boringssl/build/crypto/libcrypto.a $(BUN_DEPS_OUT_DIR)/libcrypto.boring.a

boringssl: boringssl-build boringssl-copy

libbacktrace:
	cd $(BUN_DEPS_DIR)/libbacktrace && \
	(make clean || echo "") && \
	CFLAGS="$(CFLAGS)" CC=$(CC) ./configure --disable-shared --enable-static  --with-pic && \
	make -j$(CPUS) && \
	cp ./.libs/libbacktrace.a $(BUN_DEPS_OUT_DIR)/libbacktrace.a

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
	@cmake --version >/dev/null 2>&1 || (echo -e "ERROR: cmake is required."; exit 1)
	@esbuild --version >/dev/null 2>&1 || (echo -e "ERROR: esbuild is required."; exit 1)
	@npm --version >/dev/null 2>&1 || (echo -e "ERROR: npm is required."; exit 1)
	@which aclocal > /dev/null || (echo -e  "ERROR: automake is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install automake"; exit 1)
	@which $(LIBTOOL) > /dev/null || (echo -e "ERROR: libtool is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install libtool"; exit 1)
	@which ninja > /dev/null || (echo -e "ERROR: Ninja is required. Install with:\n\n    $(POSIX_PKG_MANAGER) install ninja"; exit 1)
	@echo "You have the dependencies installed! Woo"

init-submodules:
	git submodule update --init --recursive --progress --depth=1

build-obj: 
	$(ZIG) build obj -Drelease-fast

sign-macos-x64: 
	gon sign.macos-x64.json

sign-macos-aarch64: 
	gon sign.macos-aarch64.json

cls: 
	@echo "\n\n---\n\n"

release: all-js jsc-bindings-mac build-obj cls bun-link-lld-release bun-link-lld-release-dsym release-bin-entitlements

jsc-check:
	@ls $(JSC_BASE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit build. Please compile the WebKit submodule using the Dockerfile at $(shell pwd)/src/javascript/WebKit/Dockerfile and then copy from /output in the Docker container to $(JSC_BASE_DIR). You can override the directory via JSC_BASE_DIR. \n\n 	DOCKER_BUILDKIT=1 docker build -t bun-webkit $(shell pwd)/src/javascript/jsc/WebKit -f $(shell pwd)/src/javascript/jsc/WebKit/Dockerfile --progress=plain\n\n 	docker container create bun-webkit\n\n 	# Get the container ID\n	docker container ls\n\n 	docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $(JSC_BASE_DIR)" && exit 1)	
	@ls $(JSC_INCLUDE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit include directory at $(JSC_INCLUDE_DIR)." && exit 1)	
	@ls $(JSC_LIB)  >/dev/null 2>&1 || (echo "Failed to access WebKit lib directory at $(JSC_LIB)." && exit 1)	

all-js: runtime_js fallback_decoder bun_error node-fallbacks


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

runtime_js_dev:
	@NODE_ENV=development esbuild --define:process.env.NODE_ENV="development" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js

bun_error:
	@cd packages/bun-error; $(NPM_CLIENT) install; $(NPM_CLIENT) run --silent build

generate-install-script:
	@rm -f $(PACKAGES_REALPATH)/bun/install.js 	
	@esbuild --log-level=error --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" --define:process.env.NODE_ENV="\"production\"" --platform=node  --format=cjs $(PACKAGES_REALPATH)/bun/install.ts > $(PACKAGES_REALPATH)/bun/install.js

fetch:
	$(ZIG) build -Drelease-fast fetch-obj
	$(CXX) $(PACKAGE_DIR)/fetch.o -g -O3 -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
	rm -rf $(PACKAGE_DIR)/fetch.o
	
fetch-debug:
	$(ZIG) build fetch-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/fetch.o -g -O3 -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)


httpbench-debug:
	$(ZIG) build httpbench-obj
	$(CXX) $(DEBUG_PACKAGE_DIR)/httpbench.o -g -o ./misctools/http_bench $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)


httpbench-release:
	$(ZIG) build -Drelease-fast httpbench-obj
	$(CXX) $(PACKAGE_DIR)/httpbench.o -g -O3 -o ./misctools/http_bench $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES)
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


endif

bun-codesign-debug:
bun-codesign-release-local:


jsc: jsc-build jsc-copy-headers jsc-bindings  
jsc-build: $(JSC_BUILD_STEPS)
jsc-bindings: jsc-bindings-headers jsc-bindings-mac

clone-submodules:
	git -c submodule."src/javascript/jsc/WebKit".update=none submodule update --init --recursive --depth=1 --progress

devcontainer: clone-submodules mimalloc zlib libarchive boringssl picohttp identifier-cache node-fallbacks jsc-bindings-headers api analytics bun_error fallback_decoder jsc-bindings-mac dev runtime_js_dev

jsc-bindings-headers:
	rm -f /tmp/build-jsc-headers src/javascript/jsc/bindings/headers.zig
	touch src/javascript/jsc/bindings/headers.zig
	mkdir -p src/javascript/jsc/bindings-obj/
	$(ZIG) build headers-obj
	$(CXX) $(PLATFORM_LINKER_FLAGS) -g $(DEBUG_BIN)/headers.o -W -o /tmp/build-jsc-headers $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES);
	/tmp/build-jsc-headers
	$(ZIG) translate-c src/javascript/jsc/bindings/headers.h > src/javascript/jsc/bindings/headers.zig
	$(ZIG) run misctools/headers-cleaner.zig -lc
	$(SED) -i '/pub const __darwin/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const __builtin/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const int/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const uint/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const intmax/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const uintmax/d' src/javascript/jsc/bindings/headers.zig || echo "";
	$(SED) -i '/pub const max_align_t/{N;N;N;d;}' src/javascript/jsc/bindings/headers.zig
	$(SED) -i '/pub const ZigErrorCode/d' src/javascript/jsc/bindings/headers.zig
	$(SED) -i '/pub const JSClassRef/d' src/javascript/jsc/bindings/headers.zig
	cat src/javascript/jsc/bindings/headers.zig > /tmp/headers.zig
	cat src/javascript/jsc/bindings/headers-replacements.zig /tmp/headers.zig > src/javascript/jsc/bindings/headers.zig
	$(ZIG) fmt src/javascript/jsc/bindings/headers.zig
	

MIMALLOC_OVERRIDE_FLAG ?= 


bump: 
	expr $(BUILD_ID) + 1 > build-id


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
BUN_DEPLOY_DSYM = /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET).dSYM.gz


release-bin-generate-copy:
	rm -rf /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET) $(BUN_DEPLOY_ZIP)
	mkdir -p /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET)
	cp $(BUN_RELEASE_BIN) /tmp/bun-$(PACKAGE_JSON_VERSION)/bun-$(TRIPLET)/bun
	gzip -c --keep $(BUN_RELEASE_BIN).dSYM > $(BUN_DEPLOY_DSYM)

release-bin-generate: release-bin-generate-copy release-bin-generate-zip


release-bin-check-version:
	test $(shell eval $(BUN_RELEASE_BIN) --version) = $(PACKAGE_JSON_VERSION)

release-bin-check: release-bin-check-version 

ifeq ($(OS_NAME),linux)

release-bin-check: release-bin-check-version 
# force it to run
	@make -B check-glibc-version-dependency
endif

release-bin-without-push: test-all release-bin-check release-bin-generate release-bin-codesign 
release-bin: release-bin-without-push release-bin-push

release-bin-dir:
	echo $(PACKAGE_DIR)


release-bin-push: 
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_ZIP) --repo $(BUN_AUTO_UPDATER_REPO)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM)
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_DSYM) --repo $(BUN_AUTO_UPDATER_REPO)

dev-obj:
	$(ZIG) build obj

dev-obj-linux:
	$(ZIG) build obj -Dtarget=x86_64-linux-gnu

dev: mkdir-dev dev-obj bun-link-lld-debug bun-codesign-debug

mkdir-dev:
	mkdir -p $(DEBUG_PACKAGE_DIR)/bin

test-install:
	cd integration/scripts && $(NPM_CLIENT) install

test-all: test-install test-with-hmr test-no-hmr test-create-next test-create-react test-bun-run test-bun-install

copy-test-node-modules:
	rm -rf integration/snippets/package-json-exports/node_modules || echo "";
	cp -r integration/snippets/package-json-exports/_node_modules_copy integration/snippets/package-json-exports/node_modules || echo "";
kill-bun:
	-killall -9 bun bun-debug

test-dev-create-next: 
	BUN_BIN=$(DEBUG_BUN) bash integration/apps/bun-create-next.sh

test-dev-create-react: 
	BUN_BIN=$(DEBUG_BUN) bash integration/apps/bun-create-react.sh

test-create-next: 
	BUN_BIN=$(RELEASE_BUN) bash integration/apps/bun-create-next.sh

test-bun-run: 
	cd integration/apps && BUN_BIN=$(RELEASE_BUN) bash ./bun-run-check.sh

test-bun-install: 
	cd integration/apps && JS_RUNTIME=$(RELEASE_BUN) NPM_CLIENT=$(RELEASE_BUN) bash ./bun-install.sh

test-dev-bun-install: 
	cd integration/apps && JS_RUNTIME=$(DEBUG_BUN) NPM_CLIENT=$(DEBUG_BUN) bash ./bun-install.sh

test-create-react: 
	BUN_BIN=$(RELEASE_BUN) bash integration/apps/bun-create-react.sh
	
test-with-hmr: kill-bun copy-test-node-modules
	BUN_BIN=$(RELEASE_BUN) node integration/scripts/browser.js

test-no-hmr: kill-bun copy-test-node-modules
	-killall bun -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(RELEASE_BUN) node integration/scripts/browser.js

test-dev-with-hmr: copy-test-node-modules
	-killall bun-debug -9;
	BUN_BIN=$(DEBUG_BUN) node integration/scripts/browser.js

test-dev-no-hmr: copy-test-node-modules
	-killall bun-debug -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(DEBUG_BUN) node integration/scripts/browser.js

test-dev-bun-run: 
	cd integration/apps && BUN_BIN=$(DEBUG_BUN) bash bun-run-check.sh

test-dev-all: test-dev-with-hmr test-dev-no-hmr test-dev-create-next test-dev-create-react test-dev-bun-run test-dev-bun-install
test-dev-bunjs: 

test-dev: test-dev-with-hmr

jsc-copy-headers:
	find $(WEBKIT_RELEASE_DIR)/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} $(WEBKIT_RELEASE_DIR)/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

# This is a workaround for a JSC bug that impacts aarch64
# on macOS, it never requests JIT permissions 
jsc-force-fastjit:
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/assembler/FastJITPermissions.h
	$(SED) -i "s/USE(PTHREAD_JIT_PERMISSIONS_API)/CPU(ARM64)/g" $(WEBKIT_DIR)/Source/JavaScriptCore/jit/ExecutableAllocator.cpp
	$(SED) -i "s/GIGACAGE_ENABLED/0/g" $(WEBKIT_DIR)/Source/JavaScriptCore/Gigacage.h

jsc-build-mac-compile:
	mkdir -p $(WEBKIT_RELEASE_DIR) $(WEBKIT_DIR);
	cd $(WEBKIT_RELEASE_DIR) && \
		ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" \
		CMAKE_BUILD_TYPE=Release cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=Release \
			-DUSE_THIN_ARCHIVES=OFF \
			-DENABLE_FTL_JIT=ON \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			-DCMAKE_BUILD_TYPE=Release \
			$(CMAKE_FLAGS_WITHOUT_RELEASE) \
			-DPTHREAD_JIT_PERMISSIONS_API=1 \
			-DUSE_PTHREAD_JIT_PERMISSIONS_API=ON \
			-DCMAKE_BUILD_TYPE=Release \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR) && \
	CFLAGS="$CFLAGS -ffat-lto-objects" CXXFLAGS="$CXXFLAGS -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config Release --target jsc

jsc-build-linux-compile-config:
	mkdir -p $(WEBKIT_RELEASE_DIR)
	cd $(WEBKIT_RELEASE_DIR) && \
		cmake \
			-DPORT="JSCOnly" \
			-DENABLE_STATIC_JSC=ON \
			-DCMAKE_BUILD_TYPE=relwithdebuginfo \
			-DUSE_THIN_ARCHIVES=OFF \
			-DENABLE_FTL_JIT=ON \
			-DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
			-G Ninja \
			-DCMAKE_CXX_COMPILER=$(CXX) \
			-DCMAKE_C_COMPILER=$(CC) \
			$(WEBKIT_DIR) \
			$(WEBKIT_RELEASE_DIR)

# If you get "Error: could not load cache"
# run  rm -rf src/javascript/jsc/WebKit/CMakeCache.txt
jsc-build-linux-compile-build:
		mkdir -p $(WEBKIT_RELEASE_DIR)  && \
		cd $(WEBKIT_RELEASE_DIR)  && \
	CFLAGS="$CFLAGS -ffat-lto-objects" CXXFLAGS="$CXXFLAGS -ffat-lto-objects" \
		cmake --build $(WEBKIT_RELEASE_DIR) --config relwithdebuginfo --target jsc


jsc-build-mac: jsc-force-fastjit jsc-build-mac-compile jsc-build-mac-copy

jsc-build-linux: jsc-build-linux-compile-config jsc-build-linux-compile-build jsc-build-mac-copy

jsc-build-mac-copy:
	cp $(WEBKIT_RELEASE_DIR)/lib/libJavaScriptCore.a $(BUN_DEPS_OUT_DIR)/libJavaScriptCore.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libWTF.a $(BUN_DEPS_OUT_DIR)/libWTF.a
	cp $(WEBKIT_RELEASE_DIR)/lib/libbmalloc.a $(BUN_DEPS_OUT_DIR)/libbmalloc.a
	 
clean-bindings: 
	rm -rf $(OBJ_DIR)/*.o

clean: clean-bindings
	rm $(BUN_DEPS_DIR)/*.a $(BUN_DEPS_DIR)/*.o
	(cd $(BUN_DEPS_DIR)/mimalloc && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/libarchive && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/boringssl && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/picohttp && make clean) || echo "";
	(cd $(BUN_DEPS_DIR)/zlib && make clean) || echo "";

jsc-bindings-mac: $(OBJ_FILES)


# mimalloc is built as object files so that it can overload the system malloc
mimalloc:
	cd $(BUN_DEPS_DIR)/mimalloc; CFLAGS="$(CFLAGS)" cmake $(CMAKE_FLAGS) -DMI_SKIP_COLLECT_ON_EXIT=ON -DMI_BUILD_SHARED=OFF -DMI_BUILD_STATIC=ON -DMI_BUILD_TESTS=OFF -DMI_BUILD_OBJECT=ON ${MIMALLOC_OVERRIDE_FLAG} -DMI_USE_CXX=ON .; make; 
	cp $(BUN_DEPS_DIR)/mimalloc/$(MIMALLOC_INPUT_PATH) $(BUN_DEPS_OUT_DIR)/$(MIMALLOC_FILE)

bun-link-lld-debug:
	$(CXX) $(BUN_LLD_FLAGS) \
		-g \
		$(DEBUG_BIN)/bun-debug.o \
		-W \
		-o $(DEBUG_BIN)/bun-debug \


bun-relink-copy:
	cp /tmp/bun-$(PACKAGE_JSON_VERSION).o $(BUN_RELEASE_BIN).o



bun-link-lld-release:
	$(CXX) $(BUN_LLD_FLAGS) \
		$(BUN_RELEASE_BIN).o \
		-o $(BUN_RELEASE_BIN) \
		-W \
		-flto \
		-ftls-model=initial-exec \
		-O3
	rm -rf $(BUN_RELEASE_BIN).dSYM
	cp $(BUN_RELEASE_BIN) $(BUN_RELEASE_BIN)-profile

ifeq ($(OS_NAME),darwin)
bun-link-lld-release-dsym:
	$(DSYMUTIL) -o $(BUN_RELEASE_BIN).dSYM $(BUN_RELEASE_BIN)
	-$(STRIP) $(BUN_RELEASE_BIN)
	mv $(BUN_RELEASE_BIN).o /tmp/bun-$(PACKAGE_JSON_VERSION).o

endif

ifeq ($(OS_NAME),linux)
bun-link-lld-release-dsym:
	-$(STRIP) $(BUN_RELEASE_BIN)
	mv $(BUN_RELEASE_BIN).o /tmp/bun-$(PACKAGE_JSON_VERSION).o
endif


bun-relink: bun-relink-copy bun-link-lld-release bun-link-lld-release-dsym


# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) -c -o $@ $< \
		$(CLANG_FLAGS) $(PLATFORM_LINKER_FLAGS) \
		-O1 \
		-fvectorize \
		-w -g

sizegen:
	$(CXX) src/javascript/jsc/headergen/sizegen.cpp -o $(BUN_TMP_DIR)/sizegen $(CLANG_FLAGS) -O1
	$(BUN_TMP_DIR)/sizegen > src/javascript/jsc/bindings/sizes.zig

picohttp:
	 $(CC) $(CFLAGS) -O3 -g -fPIC -c $(BUN_DEPS_DIR)/picohttpparser/picohttpparser.c -I$(BUN_DEPS_DIR) -o $(BUN_DEPS_OUT_DIR)/picohttpparser.o; cd ../../	

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
	zig test $(realpath $(testpath)) \
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
	$(ARCHIVE_FILES) $(ICU_FLAGS) && \
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
	$(ARCHIVE_FILES) $(ICU_FLAGS) $(JSC_FILES) $(OBJ_FILES) && \
	zig-out/bin/__main_test $(ZIG)

run-unit:
	@zig-out/bin/$(testname) $(ZIG)
	
	

test: build-unit run-unit

integration-test-dev: 
	USE_EXISTING_PROCESS=true TEST_SERVER_URL=http://localhost:3000 node integration/scripts/browser.js

copy-install:
	cp src/cli/install.sh ../bun.sh/docs/install.html

copy-to-bun-release-dir:
	cp -r $(PACKAGE_DIR)/bun $(BUN_RELEASE_DIR)/bun
	gzip --keep -c $(PACKAGE_DIR)/bun.dSYM > $(BUN_RELEASE_DIR)/bun.dSYM.gz
	cp -r $(PACKAGE_DIR)/bun-profile $(BUN_RELEASE_DIR)/bun-profile

PACKAGE_MAP = --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_$(OS_NAME).zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/deps/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/deps/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-end --pkg-end --pkg-end --pkg-end --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin clap $(BUN_DIR)/src/deps/zig-clap/clap.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/deps/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-begin io $(BUN_DIR)/src/io/io_darwin.zig --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/deps/boringssl.zig --pkg-end --pkg-begin thread_pool $(BUN_DIR)/src/thread_pool.zig --pkg-end --pkg-end --pkg-end --pkg-end --pkg-begin boringssl $(BUN_DIR)/src/deps/boringssl.zig --pkg-end --pkg-begin javascript_core $(BUN_DIR)/src/jsc.zig --pkg-begin http $(BUN_DIR)/src/http_client_async.zig --pkg-end --pkg-begin strings $(BUN_DIR)/src/string_immutable.zig --pkg-end --pkg-begin picohttp $(BUN_DIR)/src/deps/picohttp.zig --pkg-end --pkg-end


bun: vendor identifier-cache build-obj bun-link-lld-release bun-codesign-release-local 
