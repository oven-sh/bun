SHELL := /bin/bash # Use bash syntax to be consistent

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
PACKAGES_REALPATH = $(realpath packages)
PACKAGE_DIR = $(PACKAGES_REALPATH)/$(PACKAGE_NAME)
DEBUG_PACKAGE_DIR = $(PACKAGES_REALPATH)/debug-$(PACKAGE_NAME)
BIN_DIR = $(PACKAGE_DIR)/bin
RELEASE_BUN = $(PACKAGE_DIR)/bin/bun
DEBUG_BIN = $(DEBUG_PACKAGE_DIR)/bin
DEBUG_BUN = $(DEBUG_BIN)/bun-debug
BUILD_ID = $(shell cat ./build-id)
PACKAGE_JSON_VERSION = 0.0.$(BUILD_ID)
BUN_BUILD_TAG = bun-v$(PACKAGE_JSON_VERSION)
PACKAGE_MAC = $(PACKAGES_REALPATH)/bun-cli-mac
MAC_BIN = $(PACKAGE_MAC)/bin
MAC_BUN = $(MAC_BIN)/bun

# We must use the same compiler version for the JavaScriptCore bindings and JavaScriptCore
# If we don't do this, strange memory allocation failures occur.
# This is easier to happen than you'd expect.

CC = $(shell which clang-12 || which clang)
CXX = $(shell which clang++-12 || which clang++)

DEPS_DIR = $(shell pwd)/src/deps
CPUS ?= $(shell nproc)
USER ?= $(echo $USER)

OPENSSL_VERSION = OpenSSL_1_1_1l
LIBICONV_PATH ?= $(BREW_PREFIX_PATH)/opt/libiconv/lib/libiconv.a

OPENSSL_LINUX_DIR = $(DEPS_DIR)/openssl/openssl-OpenSSL_1_1_1l

LIBCRYPTO_PREFIX_DIR = $(BREW_PREFIX_PATH)/opt/openssl@1.1
LIBCRYPTO_STATIC_LIB ?= $(LIBCRYPTO_PREFIX_DIR)/lib/libcrypto.a
LIBCRYPTO_INCLUDE_DIR = $(LIBCRYPTO_PREFIX_DIR)/include

ifeq ($(OS_NAME),linux)
LIBCRYPTO_STATIC_LIB = 
LIBICONV_PATH = $(DEPS_DIR)/libiconv.a
endif

# Linux needs to have libcrypto 1.1.1 installed
# download-openssl-linux:
# 	mkdir -p $(DEPS_DIR)/openssl
# 	wget https://github.com/openssl/openssl/archive/refs/tags/OpenSSL_1_1_1l.zip
# 	unzip -o OpenSSL_1_1_1l.zip -d $(DEPS_DIR)/openssl
# 	rm OpenSSL_1_1_1l.zip

# build-openssl-linux:
# 	cd $(OPENSSL_LINUX_DIR); \
# 		./config -d -fPIC \
# 			no-md2 no-rc5 no-rfc3779 no-sctp no-ssl-trace no-zlib     \
# 			no-hw no-mdc2 no-seed no-idea enable-ec_nistp_64_gcc_128 no-camellia \
# 			no-bf no-ripemd no-dsa no-ssl2 no-ssl3 no-capieng                  \
# 			-DSSL_FORBID_ENULL -DOPENSSL_NO_DTLS1 -DOPENSSL_NO_HEARTBEATS; \
# 		make -j $(CPUS) depend; \
# 		make -j $(CPUS); \
# 		make -j $(CPUS) install_sw; \
# 		cp libcrypto.a $(DEPS_DIR)/libcrypto.a

build-iconv-linux:
	cd src/deps/libiconv/libiconv-1.16; ./configure --enable-static; make -j 12; cp ./lib/.libs/libiconv.a $(DEPS_DIR)/libiconv.a

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

DEFAULT_LINKER_FLAGS =

JSC_BUILD_STEPS :=
ifeq ($(OS_NAME),linux)
	JSC_BUILD_STEPS += jsc-check
DEFAULT_LINKER_FLAGS= -lcrypto -pthread -ldl 
endif
ifeq ($(OS_NAME),darwin)
	JSC_BUILD_STEPS += jsc-build-mac jsc-copy-headers
endif


STRIP ?= $(shell which llvm-strip || which llvm-strip-12 || echo "Missing llvm-strip. Please pass it in the STRIP environment var"; exit 1;)

HOMEBREW_PREFIX ?= $(BREW_PREFIX_PATH)

s2n-ubuntu-deps:
	# https://github.com/aws/s2n-tls/blob/main/codebuild/spec/buildspec_ubuntu.yml#L50
	sudo apt-get install -y --no-install-recommends indent \
		iproute2 \
		kwstyle \
		lcov \
		libssl-dev \
		m4 \
		make \
		net-tools \
		nettle-bin \
		nettle-dev \
		pkg-config \
		psmisc \
		python3-pip \
		shellcheck \
		sudo \
		tcpdump \
		unzip \
		valgrind \
		zlib1g-dev \
		zlibc \
		cmake \
		tox \
		libtool \
		ninja-build

s2n-linux:
	cd $(DEPS_DIR)/s2n-tls; \
	make clean; \
	rm -rf build; \
	CC=$(CC) CXX=$(CXX) cmake . -Bbuild -GNinja \
		-DCMAKE_BUILD_TYPE=Release \
		-DBUILD_SHARED_LIBS=OFF \
		-DBENCHMARK=0; \
	CC=$(CC) CXX=$(CXX) cmake --build ./build -j$(CPUS); \
	CC=$(CC) CXX=$(CXX) CTEST_PARALLEL_LEVEL=$(CPUS) ninja -C build;
	cp $(DEPS_DIR)/s2n-tls/build/lib/libs2n.a $(DEPS_DIR)/libs2n.a

s2n-linux-debug:
	# https://github.com/aws/s2n-tls/blob/main/codebuild/spec/buildspec_ubuntu.yml#L50
	sudo apt-get install -y --no-install-recommends indent \
		iproute2 \
		kwstyle \
		lcov \
		libssl-dev \
		m4 \
		make \
		net-tools \
		nettle-bin \
		nettle-dev \
		pkg-config \
		psmisc \
		python3-pip \
		shellcheck \
		sudo \
		tcpdump \
		unzip \
		valgrind \
		zlib1g-dev \
		zlibc \
		cmake \
		tox \
		libtool \
		ninja-build

	cd $(DEPS_DIR)/s2n-tls; \
	make clean; \
	rm -rf build; \
	CC=$(CC) CXX=$(CXX) cmake . -Bbuild -GNinja \
		-DCMAKE_BUILD_TYPE=Debug \
		-DBUILD_SHARED_LIBS=OFF \
		-DBENCHMARK=0; \
	CC=$(CC) CXX=$(CXX) cmake --build ./build -j$(CPUS); \
	CC=$(CC) CXX=$(CXX) CTEST_PARALLEL_LEVEL=$(CPUS) ninja -C build;
	cp $(DEPS_DIR)/s2n-tls/build/lib/libs2n.a $(DEPS_DIR)/libs2n.a


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

MACOS_ICU_INCLUDE = $(HOMEBREW_PREFIX)/opt/icu4c/include

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



ARCHIVE_FILES_WITHOUT_LIBCRYPTO = src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/picohttpparser.o \

ARCHIVE_FILES = $(ARCHIVE_FILES_WITHOUT_LIBCRYPTO) src/deps/libcrypto.a

PLATFORM_LINKER_FLAGS =

ifeq ($(OS_NAME), linux)
PLATFORM_LINKER_FLAGS = -lstdc++fs \
		-lc \
		-Wl,-z,now \
		-Wl,--as-needed \
		-Wl,-z,stack-size=12800000 \
		-Wl,-z,notext \
		-ffunction-sections \
		-fdata-sections \
		-Wl,--gc-sections
endif


BUN_LLD_FLAGS = $(OBJ_FILES) \
		${ICU_FLAGS} \
		${JSC_FILES} \
		$(ARCHIVE_FILES) \
		$(LIBICONV_PATH) \
		$(CLANG_FLAGS) \
		$(DEFAULT_LINKER_FLAGS) \
		$(PLATFORM_LINKER_FLAGS)


bun: vendor build-obj bun-link-lld-release


vendor-without-check: api analytics node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp zlib openssl s2n libarchive

libarchive:
	cd src/deps/libarchive; \
	(make clean || echo ""); \
	./build/clean.sh; \
	./build/autogen.sh; \
	./configure --disable-shared --enable-static  --with-pic  --disable-bsdtar   --disable-bsdcat --disable-rpath --enable-posix-regex-lib  --without-xml2  --without-expat --without-openssl  --without-iconv --without-zlib; \
	make -j${CPUS}; \
	cp ./.libs/libarchive.a $(DEPS_DIR)/libarchive.a;

tgz:
	zig build-exe -Drelease-fast --main-pkg-path $(shell pwd) ./misctools/tgz.zig $(DEPS_DIR)/zlib/libz.a $(DEPS_DIR)/libarchive.a $(LIBICONV_PATH) -lc 

tgz-debug:
	zig build-exe --main-pkg-path $(shell pwd) ./misctools/tgz.zig $(DEPS_DIR)/zlib/libz.a $(DEPS_DIR)/libarchive.a $(LIBICONV_PATH) -lc 

vendor: require init-submodules vendor-without-check

zlib: 
	cd src/deps/zlib; cmake .; make;

require:
	@echo "Checking if the required utilities are available..."
	@cmake --version >/dev/null 2>&1 || (echo "ERROR: cmake is required."; exit 1)
	@esbuild --version >/dev/null 2>&1 || (echo "ERROR: esbuild is required."; exit 1)
	@npm --version >/dev/null 2>&1 || (echo "ERROR: npm is required."; exit 1)
	@aclocal 2>&1 || (echo "ERROR: automake is required. Install on mac with:\nbrew install automake"; exit 1)
	@glibtoolize 2>&1 || (echo "ERROR: libtool is required. Install on mac with:\nbrew install libtool"; exit 1)
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

cls: 
	@echo "\n\n---\n\n"

release: all-js build-obj jsc-bindings-mac cls bun-link-lld-release release-bin-entitlements

jsc-check:
	@ls $(JSC_BASE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit build. Please compile the WebKit submodule using the Dockerfile at $(shell pwd)/src/javascript/WebKit/Dockerfile and then copy from /output in the Docker container to $(JSC_BASE_DIR). You can override the directory via JSC_BASE_DIR. \n\n 	DOCKER_BUILDKIT=1 docker build -t bun-webkit $(shell pwd)/src/javascript/jsc/WebKit -f $(shell pwd)/src/javascript/jsc/WebKit/Dockerfile --progress=plain\n\n 	docker container create bun-webkit\n\n 	# Get the container ID\n	docker container ls\n\n 	docker cp DOCKER_CONTAINER_ID_YOU_JUST_FOUND:/output $(JSC_BASE_DIR)" && exit 1)	
	@ls $(JSC_INCLUDE_DIR)  >/dev/null 2>&1 || (echo "Failed to access WebKit include directory at $(JSC_INCLUDE_DIR)." && exit 1)	
	@ls $(JSC_LIB)  >/dev/null 2>&1 || (echo "Failed to access WebKit lib directory at $(JSC_LIB)." && exit 1)	

all-js: runtime_js fallback_decoder bun_error node-fallbacks

bin-dir:
	@echo $(BIN_DIR)

api: 
	pnpm install; ./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig
	zig fmt src/api/schema.zig
	prettier --write src/api/schema.js
	prettier --write src/api/schema.d.ts

node-fallbacks: 
	@cd src/node-fallbacks; pnpm install; npm run --silent build

fallback_decoder:
	@esbuild --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

runtime_js:
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js

bun_error:
	@cd packages/bun-error; pnpm install; npm run --silent build

generate-install-script:
	@rm -f $(PACKAGES_REALPATH)/bun-cli/install.js
	# NODE_ENV=production esbuild --log-level=error --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" --define:process.env.NODE_ENV="\"production\"" --platform=node --target=node14 --bundle  --format=cjs $(PACKAGES_REALPATH)/bun-cli/node-install.ts > $(PACKAGES_REALPATH)/bun-cli/install.js

fetch:
	cd misctools; zig build-obj -Drelease-fast ./fetch.zig -fcompiler-rt -lc --main-pkg-path ../
	$(CXX) ./misctools/fetch.o -g -O3 -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc \
		src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/picohttpparser.o \
		$(LIBCRYPTO_STATIC_LIB)

fetch-debug:
	cd misctools; zig build-obj ./fetch.zig -fcompiler-rt -lc --main-pkg-path ../
	$(CXX) ./misctools/fetch.o -g -o ./misctools/fetch $(DEFAULT_LINKER_FLAGS) -lc  \
		src/deps/mimalloc/libmimalloc.a \
		src/deps/zlib/libz.a \
		src/deps/libarchive.a \
		src/deps/libs2n.a \
		src/deps/picohttpparser.o \
		$(LIBCRYPTO_STATIC_LIB)

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
	rm -f /tmp/build-jsc-headers src/javascript/jsc/bindings/headers.zig
	touch src/javascript/jsc/bindings/headers.zig
	mkdir -p src/javascript/jsc/bindings-obj/
	zig build headers-obj
	$(CXX) $(PLATFORM_LINKER_FLAGS) -g $(DEBUG_BIN)/headers.o -W -o /tmp/build-jsc-headers $(DEFAULT_LINKER_FLAGS) -lc $(ARCHIVE_FILES);
	/tmp/build-jsc-headers
	zig translate-c src/javascript/jsc/bindings/headers.h > src/javascript/jsc/bindings/headers.zig
	zig run misctools/headers-cleaner.zig -lc
	sed -i '/pub const int/d' src/javascript/jsc/bindings/headers.zig || echo "";
	sed -i '/pub const uint/d' src/javascript/jsc/bindings/headers.zig || echo "";
	sed -i '/pub const intmax/d' src/javascript/jsc/bindings/headers.zig || echo "";
	sed -i '/pub const uintmax/d' src/javascript/jsc/bindings/headers.zig || echo "";
	sed -i '/pub const max_align_t/{N;N;N;d;}' src/javascript/jsc/bindings/headers.zig
	sed -i '/pub const ZigErrorCode/d' src/javascript/jsc/bindings/headers.zig
	sed -i '/pub const JSClassRef/d' src/javascript/jsc/bindings/headers.zig
	zig fmt src/javascript/jsc/bindings/headers.zig
	

bump: 
	expr $(BUILD_ID) + 1 > build-id


# When adding a new architecture, don't forget to update this!
write-package-json-version-cli-json:
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' packages/bun-cli/package.json  > packages/bun-cli/package.json.new
	mv packages/bun-cli/package.json.new packages/bun-cli/package.json
	jq -S --raw-output '.optionalDependencies."bun-cli-linux-x64" = "${PACKAGE_JSON_VERSION}"' packages/bun-cli/package.json  > packages/bun-cli/package.json.new
	mv packages/bun-cli/package.json.new packages/bun-cli/package.json
	jq -S --raw-output '.optionalDependencies."bun-cli-mac" = "${PACKAGE_JSON_VERSION}"' packages/bun-cli/package.json  > packages/bun-cli/package.json.new
	mv packages/bun-cli/package.json.new packages/bun-cli/package.json

write-package-json-version: 
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' $(PACKAGE_DIR)/package.json  > $(PACKAGE_DIR)/package.json.new
	mv $(PACKAGE_DIR)/package.json.new $(PACKAGE_DIR)/package.json

write-package-json-version-cli: write-package-json-version-cli-json generate-install-script

write-package-json-version-mac: 
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' $(PACKAGE_MAC)/package.json  > $(PACKAGE_MAC)/package.json.new
	mv $(PACKAGE_MAC)/package.json.new $(PACKAGE_MAC)/package.json

tag: 
	git tag $(BUN_BUILD_TAG)
	git push --tags

prepare-release: tag release-create write-package-json-version-cli write-package-json-version write-package-json-version-mac

release-create:
	gh release create --title "Bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)"

BUN_DEPLOY_DIR = $(BUN_TMP_DIR)/bun-deploy
BUN_DEPLOY_CLI = $(BUN_TMP_DIR)/bun-cli
BUN_DEPLOY_PKG = $(BUN_DEPLOY_DIR)/$(PACKAGE_NAME)
BUN_DEPLOY_TGZ = $(BUN_DEPLOY_PKG)/$(PACKAGE_NAME)-$(PACKAGE_JSON_VERSION).tgz

BUN_DEPLOY_PKG_MAC = $(BUN_DEPLOY_DIR)/bun-cli-mac
BUN_DEPLOY_TGZ_MAC = $(BUN_DEPLOY_PKG_MAC)/bun-cli-mac-$(PACKAGE_JSON_VERSION).tgz

release-cli-generate: write-package-json-version-cli release-cli-generate-build

release-cli-generate-build: 
	rm -rf $(BUN_DEPLOY_CLI)
	mkdir -p $(BUN_DEPLOY_CLI)
	cp -r packages/bun-cli $(BUN_DEPLOY_CLI)
	cd $(BUN_DEPLOY_CLI)/bun-cli; npm pack;

release-cli-check-npm:
	rm -rf /tmp/bun-cli-check-release;
	mkdir -p /tmp/bun-cli-check-release;
	cd /tmp/bun-cli-check-release && npm install $(BUN_DEPLOY_CLI)/bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz
	test $(PACKAGE_JSON_VERSION) == $(shell eval "cd /tmp/bun-cli-check-release; ./node_modules/.bin/bun --version || echo \"FAIL\"" )

release-cli-check-yarn:
	rm -rf /tmp/bun-cli-check-release;
	mkdir -p /tmp/bun-cli-check-release;
	cd /tmp/bun-cli-check-release && yarn add $(BUN_DEPLOY_CLI)/bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz
	test $(PACKAGE_JSON_VERSION) == $(shell eval "cd /tmp/bun-cli-check-release; ./node_modules/.bin/bun --version || echo \"FAIL\"" )

release-cli-push:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_CLI)/bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz
	npm publish $(BUN_DEPLOY_CLI)/bun-cli/bun-cli-$(PACKAGE_JSON_VERSION).tgz --access=public

release-bin-generate: write-package-json-version
	rm -rf $(BUN_DEPLOY_DIR)
	mkdir -p $(BUN_DEPLOY_DIR)
	cp -r $(PACKAGE_DIR) $(BUN_DEPLOY_DIR)
	cd $(BUN_DEPLOY_PKG); npm pack;

release-mac-generate: write-package-json-version-mac
	rm -rf $(BUN_DEPLOY_DIR)
	mkdir -p $(BUN_DEPLOY_DIR)
	cp -r $(PACKAGE_MAC) $(BUN_DEPLOY_DIR)
	cd $(BUN_DEPLOY_PKG_MAC); npm pack;

release-bin-entitlements:
release-bin-entitlements-mac:

ifeq ($(OS_NAME),darwin)
# Without this, JIT will fail on aarch64
# strip will remove the entitlements.plist 
# which, in turn, will break JIT
release-bin-entitlements:
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvv --deep --strict $(BIN_DIR)/bun

release-bin-entitlements-mac:
	codesign --entitlements $(realpath entitlements.plist) --options runtime --force --timestamp --sign "$(CODESIGN_IDENTITY)" -vvv --deep --strict $(MAC_BUN)

endif


release-bin-codesign:
	mkdir -p $(BUN_DEPLOY_ZIP)-input/package
	tar -xzvf $(BUN_DEPLOY_TGZ) package
	zip -r $(BUN_DEPLOY_ZIP) package
	xcrun notarytool submit --wait $(BUN_DEPLOY_ZIP)

release-bin-notarize:
	xcrun notarytool submit $(BIN_DIR)/bun

release-bin-without-push: test-all release-bin-check 
release-bin: release-bin-without-push release-bin-push
release-mac-without-push: release-mac-generate-bin release-bin-entitlements-mac test-all-mac release-mac-generate release-mac-check
release-mac: release-mac-without-push release-mac-push

release-bin-check:
	rm -rf /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	mkdir -p /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	echo "{\"name\": \"bun-test-$(PACKAGE_JSON_VERSION)\"}" > /tmp/bun-$(PACKAGE_JSON_VERSION)-check/package.json
	cd /tmp/bun-$(PACKAGE_JSON_VERSION)-check && npm install $(BUN_DEPLOY_TGZ)
	test "$(PACKAGE_JSON_VERSION)" == "$(shell eval /tmp/bun-$(PACKAGE_JSON_VERSION)-check/node_modules/.bin/bun --version)"

release-bin-check-yarn:
	rm -rf /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	mkdir -p /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	echo "{\"name\": \"bun-test-$(PACKAGE_JSON_VERSION)\"}" > /tmp/bun-$(PACKAGE_JSON_VERSION)-check/package.json
	cd /tmp/bun-$(PACKAGE_JSON_VERSION)-check && yarn add $(BUN_DEPLOY_TGZ)
	test "$(PACKAGE_JSON_VERSION)" == "$(shell eval /tmp/bun-$(PACKAGE_JSON_VERSION)-check/node_modules/.bin/bun --version)"

release-mac-check:
	rm -rf /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	mkdir -p /tmp/bun-$(PACKAGE_JSON_VERSION)-check;
	echo "{\"name\": \"bun-test-$(PACKAGE_JSON_VERSION)\"}" > /tmp/bun-$(PACKAGE_JSON_VERSION)-check/package.json
	cd /tmp/bun-$(PACKAGE_JSON_VERSION)-check && npm install $(BUN_DEPLOY_TGZ_MAC)
	test "$(PACKAGE_JSON_VERSION)" == "$(shell eval /tmp/bun-$(PACKAGE_JSON_VERSION)-check/node_modules/.bin/bun --version)"

release-bin-push: 
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_TGZ)
	npm publish $(BUN_DEPLOY_TGZ) --access=public

release-mac-push:
	gh release upload $(BUN_BUILD_TAG) --clobber $(BUN_DEPLOY_TGZ_MAC)
	npm publish $(BUN_DEPLOY_TGZ_MAC) --access=public

release-mac-generate-bin:
	rm -rf /tmp/bun-fat-$(PACKAGE_JSON_VERSION)
	mkdir -p /tmp/bun-fat-$(PACKAGE_JSON_VERSION)
	curl "https://registry.npmjs.org/bun-cli-darwin-aarch64/-/bun-cli-darwin-aarch64-0.0.37.tgz" > /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/aarch64.tgz
	curl "https://registry.npmjs.org/bun-cli-darwin-x64/-/bun-cli-darwin-x64-0.0.37.tgz" > /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/x64.tgz
	mkdir /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/x64
	mkdir /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/aarch64
	cd /tmp/bun-fat-$(PACKAGE_JSON_VERSION) && tar -xvf x64.tgz -C x64
	cd /tmp/bun-fat-$(PACKAGE_JSON_VERSION) && tar -xvf aarch64.tgz -C aarch64
	rm -f $(MAC_BUN)
	lipo -create -output $(MAC_BUN) /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/x64/package/bin/bun /tmp/bun-fat-$(PACKAGE_JSON_VERSION)/aarch64/package/bin/bun

dev-obj:
	zig build obj

dev-obj-linux:
	zig build obj -Dtarget=x86_64-linux-gnu

dev: mkdir-dev dev-obj bun-link-lld-debug

mkdir-dev:
	mkdir -p $(DEBUG_PACKAGE_DIR)/bin

test-install:
	cd integration/scripts && pnpm install

test-all: test-install test-with-hmr test-no-hmr test-create-next test-create-react test-bun-run
test-all-mac: test-install test-with-hmr-mac test-no-hmr-mac test-create-next-mac test-create-react-mac test-bun-run-mac

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

test-create-react: 
	BUN_BIN=$(RELEASE_BUN) bash integration/apps/bun-create-react.sh
	
test-with-hmr: kill-bun copy-test-node-modules
	BUN_BIN=$(RELEASE_BUN) node integration/scripts/browser.js

test-no-hmr: kill-bun copy-test-node-modules
	-killall bun -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(RELEASE_BUN) node integration/scripts/browser.js

test-create-next-mac: 
	BUN_BIN=$(MAC_BUN) bash integration/apps/bun-create-next.sh

test-bun-run-mac: 
	cd integration/apps && BUN_BIN=$(MAC_BUN) bash ./bun-run-check.sh

test-create-react-mac: 
	BUN_BIN=$(MAC_BUN) bash integration/apps/bun-create-react.sh
	
test-with-hmr-mac: kill-bun copy-test-node-modules
	BUN_BIN=$(MAC_BUN) node integration/scripts/browser.js

test-no-hmr-mac: kill-bun copy-test-node-modules
	-killall bun -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(MAC_BUN) node integration/scripts/browser.js

test-dev-with-hmr: copy-test-node-modules
	-killall bun-debug -9;
	BUN_BIN=$(DEBUG_BUN) node integration/scripts/browser.js

test-dev-no-hmr: copy-test-node-modules
	-killall bun-debug -9;
	DISABLE_HMR="DISABLE_HMR" BUN_BIN=$(DEBUG_BUN) node integration/scripts/browser.js

test-dev-bun-run: 
	cd integration/apps && BUN_BIN=$(DEBUG_BUN) bash bun-run-check.sh

test-dev-all: test-dev-with-hmr test-dev-no-hmr test-dev-create-next text-dev-create-react test-dev-bun-run

test-dev: test-dev-with-hmr

jsc-copy-headers:
	find src/javascript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} src/javascript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders/JavaScriptCore/ \;

jsc-build-mac-compile:
	cd src/javascript/jsc/WebKit && ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo -DPTHREAD_JIT_PERMISSIONS_API=1"

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


bun-relink-copy:
	cp /tmp/bun-$(PACKAGE_JSON_VERSION).o $(BIN_DIR)/bun.o

bun-relink: bun-relink-copy bun-link-lld-release

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
	mv $(BIN_DIR)/bun.o /tmp/bun-$(PACKAGE_JSON_VERSION).o

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	$(CXX) -c -o $@ $< \
		$(CLANG_FLAGS) \
		-O1 \
		-w

sizegen:
	$(CXX) src/javascript/jsc/headergen/sizegen.cpp -o $(BUN_TMP_DIR)/sizegen $(CLANG_FLAGS) -O1
	$(BUN_TMP_DIR)/sizegen > src/javascript/jsc/bindings/sizes.zig

picohttp:
	 $(CC) -march=native -O3 -g -fPIE -c src/deps/picohttpparser/picohttpparser.c -Isrc/deps -o src/deps/picohttpparser.o; cd ../../	

analytics:
	./node_modules/.bin/peechy --schema src/analytics/schema.peechy --zig src/analytics/analytics_schema.zig
	zig fmt src/analytics/analytics_schema.zig

analytics-features:
	@cd misctools; zig run --main-pkg-path ../ ./features.zig

find-unused-zig-files: 
	@bash ./misctools/find-unused-zig.sh

generate-unit-tests: 
	@bash ./misctools/generate-test-file.sh

fmt-all:
	find src -name "*.zig" -exec zig fmt {} \;

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
	--pkg-begin picohttp $(DEPS_DIR)/picohttp.zig --pkg-end \
	--pkg-begin clap $(DEPS_DIR)/zig-clap/clap.zig --pkg-end \
	--main-pkg-path $(shell pwd) \
	--test-no-exec \
	-fPIC \
	-femit-bin=zig-out/bin/$(testname) \
	-fcompiler-rt \
	-lc -lc++ \
	--cache-dir /tmp/zig-cache-bun-$(testname)-$(basename $(lastword $(testfilter))) \
	-fallow-shlib-undefined \
	-L$(LIBCRYPTO_PREFIX_DIR)/lib \
	-lcrypto -lssl \
	$(ARCHIVE_FILES_WITHOUT_LIBCRYPTO) $(ICU_FLAGS) && \
	cp zig-out/bin/$(testname) $(testbinpath)

run-unit:
	@zig-out/bin/$(testname) -- fake
	

test: build-unit run-unit

integration-test-dev: 
	USE_EXISTING_PROCESS=true node integration/scripts/browser.js