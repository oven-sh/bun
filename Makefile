OS_NAME := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH_NAME_RAW := $(shell uname -m)

make-lazy = $(eval $1 = $​$(eval $1 := $(value $(1)))$​$($1))

ARCH_NAME :=
ifeq ($(ARCH_NAME_RAW),arm64)
   ARCH_NAME = aarch64
   BREW_PREFIX_PATH = /opt/homebrew
else
   ARCH_NAME = x64
   BREW_PREFIX_PATH = /usr/local
endif

TRIPLET = $(OS_NAME)-$(ARCH_NAME)
PACKAGE_NAME = bun-cli-$(TRIPLET)
PACKAGES_REALPATH = $(shell realpath packages)
PACKAGE_DIR = $(PACKAGES_REALPATH)/$(PACKAGE_NAME)
DEBUG_PACKAGE_DIR = $(PACKAGES_REALPATH)/debug-$(PACKAGE_NAME)
BIN_DIR = $(PACKAGE_DIR)/bin
RELEASE_BUN = $(PACKAGE_DIR)/bin/bun
DEBUG_BIN = $(DEBUG_PACKAGE_DIR)/bin
DEBUG_BUN = $(DEBUG_BIN)/bun-debug
BUILD_ID = $(shell cat ./build-id)
PACKAGE_JSON_VERSION = 0.0.$(BUILD_ID)
BUN_BUILD_TAG = bun-v$(PACKAGE_JSON_VERSION)
CC ?= $(shell realpath clang)
CXX ?= $(shell realpath clang++)
DEPS_DIR = $(shell pwd)/src/deps
CPUS ?= $(shell nproc)
USER ?= $(echo $USER)

LIBICONV_PATH ?= $(BREW_PREFIX_PATH)/opt/libiconv/lib/libiconv.a

LIBCRYPTO_PREFIX_DIR = $(BREW_PREFIX_PATH)/opt/openssl@1.1
LIBCRYPTO_STATIC_LIB ?= $(LIBCRYPTO_PREFIX_DIR)/lib/libcrypto.a
LIBCRYPTO_INCLUDE_DIR = $(LIBCRYPTO_PREFIX_DIR)/include

ifeq ($(OS_NAME),linux)
LIBCRYPTO_STATIC_LIB = /usr/lib/x86_64-linux-gnu/lib/libcrypto.a
LIBICONV_PATH = $(DEPS_DIR)/libiconv.a
endif


BUN_TMP_DIR := /tmp/make-bun

DEFAULT_USE_BMALLOC := 1
# ifeq ($(OS_NAME),linux)
# 	DEFAULT_USE_BMALLOC = 0
# endif

USE_BMALLOC ?= DEFAULT_USE_BMALLOC

JSC_BASE_DIR ?= ${HOME}/webkit-build

DEFAULT_JSC_LIB := 

ifeq ($(OS_NAME),linux)
DEFAULT_JSC_LIB = $(JSC_BASE_DIR)/lib
endif

ifeq ($(OS_NAME),darwin)
DEFAULT_JSC_LIB = src/deps
endif

JSC_LIB ?= $(DEFAULT_JSC_LIB)

JSC_INCLUDE_DIR ?= $(JSC_BASE_DIR)/include
ZLIB_INCLUDE_DIR ?= $(DEPS_DIR)/zlib
ZLIB_LIB_DIR ?= $(DEPS_DIR)/zlib

JSC_FILES := $(JSC_LIB)/libJavaScriptCore.a $(JSC_LIB)/libWTF.a  $(JSC_LIB)/libbmalloc.a

JSC_BUILD_STEPS :=
ifeq ($(OS_NAME),linux)
	JSC_BUILD_STEPS += jsc-check
endif
ifeq ($(OS_NAME),darwin)
	JSC_BUILD_STEPS += jsc-build-mac jsc-copy-headers
endif


STRIP ?= $(shell which llvm-strip || which llvm-strip-12 || echo "Missing llvm-strip. Please pass it in the STRIP environment var"; exit 1;)

HOMEBREW_PREFIX ?= $(BREW_PREFIX_PATH)


SRC_DIR := src/javascript/jsc/bindings
OBJ_DIR := src/javascript/jsc/bindings-obj
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
MAC_INCLUDE_DIRS := -Isrc/javascript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/WTF/Headers \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/ICU/Headers \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/ \
		-Isrc/javascript/jsc/bindings/ \
		-Isrc/javascript/jsc/WebKit/Source/bmalloc 

LINUX_INCLUDE_DIRS := -I$(JSC_INCLUDE_DIR) \
					  -Isrc/javascript/jsc/bindings/

INCLUDE_DIRS :=

ifeq ($(OS_NAME),linux)
	INCLUDE_DIRS += $(LINUX_INCLUDE_DIRS)
endif

ifeq ($(OS_NAME),darwin)
	INCLUDE_DIRS += $(MAC_INCLUDE_DIRS)
endif



MACOS_ICU_FILES = $(HOMEBREW_PREFIX)/opt/icu4c/lib/libicudata.a \
	$(HOMEBREW_PREFIX)/opt/icu4c/lib/libicui18n.a \
	$(HOMEBREW_PREFIX)/opt/icu4c/lib/libicuuc.a 

MACOS_ICU_INCLUDE = $(HOMEBREW_PREFIX)opt/icu4c/include

ICU_FLAGS := 

# TODO: find a way to make this more resilient
# Ideally, we could just look up the linker search paths
LIB_ICU_PATH ?= /usr/lib/x86_64-linux-gnu

ifeq ($(OS_NAME),linux)
	ICU_FLAGS += $(LIB_ICU_PATH)/libicuuc.a $(LIB_ICU_PATH)/libicudata.a $(LIB_ICU_PATH)/libicui18n.a
endif

ifeq ($(OS_NAME),darwin)
ICU_FLAGS += -l icucore \
	$(MACOS_ICU_FILES) \
	-I$(MACOS_ICU_INCLUDE)
endif

		

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
		-fPIE
		
# This flag is only added to webkit builds on Apple platforms
# It has something to do with ICU
ifeq ($(OS_NAME), darwin)
CLANG_FLAGS += -DDU_DISABLE_RENAMING=1 
endif

BUN_LLD_FLAGS = $(OBJ_FILES) \
		${ICU_FLAGS} \
		${JSC_FILES} \
		src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/libcrypto.a \
		src/deps/picohttpparser.o \
		$(LIBICONV_PATH) \
		$(CLANG_FLAGS) \
		-liconv \

ifeq ($(OS_NAME), linux)
BUN_LLD_FLAGS += -lstdc++fs \
		-pthread \
		-ldl \
		-lc \
		-Wl,-z,now \
		-Wl,--as-needed \
		-Wl,-z,stack-size=12800000 \
		-Wl,-z,notext \
		-ffunction-sections \
		-fdata-sections \
		-Wl,--gc-sections \
		-fuse-ld=lld
endif

bun: vendor build-obj bun-link-lld-release


vendor-without-check: api analytics node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib openssl s2n libarchive

libarchive:
	cd src/deps/libarchive; \
	cmake . -DENABLE_ZLIB=OFF -DENABLE_OPENSSL=OFF; \
	make -j${CPUS}; \
	cp libarchive/libarchive.a $(DEPS_DIR)/libarchive.a;

vendor: require init-submodules vendor-without-check

zlib: 
	cd src/deps/zlib; cmake .; make;

require:
	@echo "Checking if the required utilities are available..."
	@realpath --version >/dev/null 2>&1 || (echo "ERROR: realpath is required."; exit 1)
	@cmake --version >/dev/null 2>&1 || (echo "ERROR: cmake is required."; exit 1)
	@esbuild --version >/dev/null 2>&1 || (echo "ERROR: esbuild is required."; exit 1)
	@npm --version >/dev/null 2>&1 || (echo "ERROR: npm is required."; exit 1)
	@stat $(LIBICONV_PATH) >/dev/null 2>&1 || (echo "ERROR: libiconv is required. Please:\nbrew install libiconv"; exit 1)
	@stat $(LIBCRYPTO_STATIC_LIB) >/dev/null 2>&1 || (echo "ERROR: OpenSSL 1.1 is required. Please:\nbrew install openssl@1.1"; exit 1)

init-submodules:
	git submodule update --init --recursive --progress --depth=1

build-obj: 
	zig build obj -Drelease-fast

sign-macos-x64: 
	gon sign.macos-x64.json

sign-macos-aarch64: 
	gon sign.macos-aarch64.json

release: all-js build-obj jsc-bindings-mac bun-link-lld-release

jsc-check:
	@ls $(JSC_BASE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit build. Please compile the WebKit submodule using the Dockerfile at $(shell pwd)/src/javascript/WebKit/Dockerfile and then copy from /output in the Docker container to $(JSC_BASE_DIR). You can override the directory via JSC_BASE_DIR. \n\n 	DOCKER_BUILDKIT=1 docker build -t bun-webkit $(shell pwd)/src/javascript/jsc/WebKit -f $(shell pwd)/src/javascript/jsc/WebKit/Dockerfile --progress=plain\n\n 	docker container create bun-webkit\n\n 	# Get the container ID\n	docker container ls\n\n 	docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $(JSC_BASE_DIR)" && exit 1)	
	@ls $(JSC_INCLUDE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit include directory at $(JSC_INCLUDE_DIR)." && exit 1)	
	@ls $(JSC_LIB)  >/dev/null 2>&1 || (echo "Failed to access WebKit lib directory at $(JSC_LIB)." && exit 1)	

all-js: runtime_js fallback_decoder bun_error node-fallbacks

bin-dir:
	@echo $(BIN_DIR)

api: 
	npm install; ./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig

node-fallbacks: 
	@cd src/node-fallbacks; npm install; npm run --silent build

fallback_decoder:
	@esbuild --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

runtime_js:
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js

bun_error:
	@cd packages/bun-error; npm install; npm run --silent build

fetch:
	cd misctools; zig build-obj -Drelease-fast ./fetch.zig -fcompiler-rt --main-pkg-path ../
	$(CXX) ./misctools/fetch.o -g -O3 -o ./misctools/fetch \
		src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/picohttpparser.o \
		src/deps/libcrypto.a

fetch-debug:
	cd misctools; zig build-obj ./fetch.zig -fcompiler-rt --main-pkg-path ../
	$(CXX) ./misctools/fetch.o -g -o ./misctools/fetch \
		src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/picohttpparser.o \
		src/deps/libcrypto.a

s2n-mac:
	cd $(DEPS_DIR)/s2n-tls; \
	make clean; \
	CC=$(CC) CXX=$(CXX) cmake . -Bbuild -GNinja \
		-DCMAKE_BUILD_TYPE=Release \
		-DBUILD_SHARED_LIBS=OFF \
		-DLibCrypto_INCLUDE_DIR=$(LIBCRYPTO_INCLUDE_DIR) \
		-DLibCrypto_STATIC_LIBRARY=$(LIBCRYPTO_STATIC_LIB) \
		-DLibCrypto_LIBRARY=$(LIBCRYPTO_STATIC_LIB) \
		-DCMAKE_PREFIX_PATH=$(LIBCRYPTO_PREFIX_DIR); \
	CC=$(CC) CXX=$(CXX) cmake --build ./build -j$(CPUS); \
	CC=$(CC) CXX=$(CXX) CTEST_PARALLEL_LEVEL=$(CPUS) ninja -C build
	cp $(DEPS_DIR)/s2n-tls/build/lib/libs2n.a $(DEPS_DIR)/libs2n.a
	unlink $(DEPS_DIR)/libcrypto.a || echo "";
	ln $(LIBCRYPTO_STATIC_LIB) $(DEPS_DIR)/libcrypto.a || echo "";

s2n-mac-debug:
	cd $(DEPS_DIR)/s2n-tls; \
	make clean; \
	CC=$(CC) CXX=$(CXX) cmake . -Bbuild -GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DBUILD_SHARED_LIBS=OFF \
		-DLibCrypto_INCLUDE_DIR=$(LIBCRYPTO_INCLUDE_DIR) \
		-DLibCrypto_STATIC_LIBRARY=$(LIBCRYPTO_STATIC_LIB) \
		-DLibCrypto_LIBRARY=$(LIBCRYPTO_STATIC_LIB) \
		-DCMAKE_PREFIX_PATH=$(LIBCRYPTO_PREFIX_DIR); \
	CC=$(CC) CXX=$(CXX) cmake --build ./build -j$(CPUS); \
	CC=$(CC) CXX=$(CXX) CTEST_PARALLEL_LEVEL=$(CPUS) ninja -C build test
	cp $(DEPS_DIR)/s2n-tls/build/lib/libs2n.a $(DEPS_DIR)/libs2n.a
	unlink $(DEPS_DIR)/libcrypto.a || echo "";
	ln $(LIBCRYPTO_STATIC_LIB) $(DEPS_DIR)/libcrypto.a || echo "";

libcrypto_path:
	@echo ${LIBCRYPTO_STATIC_LIB}

ifeq ($(OS_NAME),darwin)
s2n: s2n-mac
endif

jsc: jsc-build jsc-bindings
jsc-build: $(JSC_BUILD_STEPS)
jsc-bindings: jsc-bindings-headers jsc-bindings-mac
	
jsc-bindings-headers:
	mkdir -p src/javascript/jsc/bindings-obj/
	zig build headers

bump: 
	expr $(BUILD_ID) + 1 > build-id


build_postinstall: 
	@esbuild --bundle --format=cjs --platform=node --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" packages/bun-cli/scripts/postinstall.ts > packages/bun-cli/postinstall.js

write-package-json-version-cli: build_postinstall
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' packages/bun-cli/package.json  > packages/bun-cli/package.json.new
	mv packages/bun-cli/package.json.new packages/bun-cli/package.json

write-package-json-version: 
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' $(PACKAGE_DIR)/package.json  > $(PACKAGE_DIR)/package.json.new
	mv $(PACKAGE_DIR)/package.json.new $(PACKAGE_DIR)/package.json

tag: 
	git tag $(BUN_BUILD_TAG)
	git push --tags

prepare-release: tag release-create write-package-json-version-cli write-package-json-version

release-create:
	gh release create --title "Bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)"

BUN_DEPLOY_DIR := $(BUN_TMP_DIR)/bun-deploy
BUN_DEPLOY_CLI := $(BUN_TMP_DIR)/bun-cli
BUN_DEPLOY_PKG := $(BUN_DEPLOY_DIR)/$(PACKAGE_NAME)

release-cli-push:
	rm -rf $(BUN_DEPLOY_CLI)
	mkdir -p $(BUN_DEPLOY_CLI)
	cp -r packages/bun-cli $(BUN_DEPLOY_CLI)
	cd $(BUN_DEPLOY_CLI)/bun-cli; npm pack;
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_CLI)//bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz
	npm publish $(BUN_DEPLOY_CLI)/bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz --access=public

release-bin-push: write-package-json-version
	rm -rf $(BUN_DEPLOY_DIR)
	mkdir -p $(BUN_DEPLOY_DIR)
	cp -r $(PACKAGE_DIR) $(BUN_DEPLOY_DIR)
	cd $(BUN_DEPLOY_PKG); npm pack;
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_PKG)/$(PACKAGE_NAME)-$(PACKAGE_JSON_VERSION).tgz
	npm publish $(BUN_DEPLOY_PKG)/$(PACKAGE_NAME)-$(PACKAGE_JSON_VERSION).tgz --access=public

dev-obj:
	zig build obj

dev-obj-linux:
	zig build obj -Dtarget=x86_64-linux-gnu

dev: mkdir-dev dev-obj bun-link-lld-debug

mkdir-dev:
	mkdir -p $(DEBUG_PACKAGE_DIR)/bin

test-install:
	cd integration/scripts && npm install

test-all: test-install test-with-hmr test-no-hmr

copy-test-node-modules:
	rm -rf integration/snippets/package-json-exports/node_modules || echo "";
	cp -r integration/snippets/package-json-exports/_node_modules_copy integration/snippets/package-json-exports/node_modules || echo "";
kill-bun:
	-killall -9 bun bun-debug
	
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

test-dev-all: test-dev-with-hmr test-dev-no-hmr

test-dev: test-dev-with-hmr

jsc-copy-headers:
	find src/javascript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} src/javascript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

jsc-build-mac-compile:
	cd src/javascript/jsc/WebKit && ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo"

jsc-build-linux-compile:
	cd src/javascript/jsc/WebKit && ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo -DUSE_THIN_ARCHIVES=OFF"

jsc-build-mac: jsc-build-mac-compile jsc-build-mac-copy

jsc-build-linux: jsc-build-linux-compile jsc-build-mac-copy

jsc-build-mac-copy:
	cp src/javascript/jsc/WebKit/WebKitBuild/Release/lib/libJavaScriptCore.a src/deps/libJavaScriptCore.a
	cp src/javascript/jsc/WebKit/WebKitBuild/Release/lib/libWTF.a src/deps/libWTF.a
	cp src/javascript/jsc/WebKit/WebKitBuild/Release/lib/libbmalloc.a src/deps/libbmalloc.a
	 
clean-bindings: 
	rm -rf $(OBJ_DIR)/*.o

clean: clean-bindings
	rm src/deps/*.a src/deps/*.o
	(cd src/deps/mimalloc && make clean) || echo "";
	(cd src/deps/libarchive && make clean) || echo "";
	(cd src/deps/s2n-tls && make clean) || echo "";
	(cd src/deps/picohttp && make clean) || echo "";
	(cd src/deps/zlib && make clean) || echo "";



jsc-bindings-mac: $(OBJ_FILES)


mimalloc:
	cd src/deps/mimalloc; cmake .; make; 

bun-link-lld-debug:
	$(CXX) $(BUN_LLD_FLAGS) \
		-g \
		$(DEBUG_BIN)/bun-debug.o \
		-W \
		-o $(DEBUG_BIN)/bun-debug \

bun-link-lld-release:
	$(CXX) $(BUN_LLD_FLAGS) \
		$(BIN_DIR)/bun.o \
		-o $(BIN_DIR)/bun \
		-W \
		-flto \
		-ftls-model=initial-exec \
		-O3
	cp $(BIN_DIR)/bun $(BIN_DIR)/bun-profile
	$(STRIP) $(BIN_DIR)/bun
	rm $(BIN_DIR)/bun.o

bun-link-lld-release-aarch64:
	$(CXX) $(BUN_LLD_FLAGS) \
		build/macos-aarch64/bun.o \
		-o build/macos-aarch64/bun \
		-Wl,-dead_strip \
		-ftls-model=initial-exec \
		-flto \
		-O3

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) -c -o $@ $< \
		$(CLANG_FLAGS) \
		-O1

sizegen:
	$(CXX) src/javascript/jsc/headergen/sizegen.cpp -o $(BUN_TMP_DIR)/sizegen $(CLANG_FLAGS) -O1
	$(BUN_TMP_DIR)/sizegen > src/javascript/jsc/bindings/sizes.zig

picohttp:
	 $(CC) -march=native -O3 -g -fPIE -c src/deps/picohttpparser/picohttpparser.c -Isrc/deps -o src/deps/picohttpparser.o; cd ../../	

analytics:
	 ./node_modules/.bin/peechy --schema src/analytics/schema.peechy --zig src/analytics/analytics_schema.zig

analytics-features:
	@cd misctools; zig run --main-pkg-path ../ ./features.zig