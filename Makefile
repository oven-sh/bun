OS_NAME := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ARCH_NAME_DENORAMLZIED_1 := $(shell uname -m)
ARCH_NAME_DENORAMLZIED_2 := $(shell tr '[_]' '[--]' <<< $(ARCH_NAME_DENORAMLZIED_1))
ARCH_NAME_DENORAMLZIED_3 := $(shell sed s/x86-64/x64/ <<< $(ARCH_NAME_DENORAMLZIED_2))
ARCH_NAME := $(shell sed s/arm64/aarch64/ <<< $(ARCH_NAME_DENORAMLZIED_3))
TRIPLET := $(OS_NAME)-$(ARCH_NAME)
PACKAGE_DIR := packages/bun-cli-$(TRIPLET)
DEBUG_PACKAGE_DIR := packages/debug-bun-cli-$(TRIPLET)
BIN_DIR := $(PACKAGE_DIR)/bin
RELEASE_BIN := $(BIN_DIR)/bun
DEBUG_BIN := $(DEBUG_PACKAGE_DIR)/bin
BUILD_ID := $(shell cat ./build-id)
PACKAGE_JSON_VERSION := 0.0.0-$(BUILD_ID)
BUN_BUILD_TAG := bun-v$(PACKAGE_JSON_VERSION)

bun: vendor build-obj bun-link-lld-release

vendor: api node-fallbacks runtime_js fallback_decoder bun_error mimalloc picohttp jsc

build-obj: 
	zig build obj -Drelease-fast

sign-macos-x64: 
	gon sign.macos-x64.json

sign-macos-aarch64: 
	gon sign.macos-aarch64.json

release-macos-x64: build-obj jsc-bindings-mac bun-link-lld-release
release-macos-aarch64: build-obj jsc-bindings-mac bun-link-lld-release sign-macos-aarch64

bin-dir:
	@echo $(BIN_DIR)

api: 
	npm install; ./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig

node-fallbacks: 
	cd src/node-fallbacks; npm install; npm run --silent build

fallback_decoder:
	@esbuild --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

runtime_js:
	@NODE_ENV=production esbuild --define:process.env.NODE_ENV="production" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js

bun_error:
	cd packages/bun-error; npm install; npm run --silent build

jsc: jsc-build jsc-bindings
jsc-build: jsc-build-mac jsc-copy-headers
jsc-bindings: jsc-bindings-headers jsc-bindings-mac
	
jsc-bindings-headers:
	mkdir -p src/JavaScript/jsc/bindings-obj/
	zig build headers

bump: 
	expr $(BUILD_ID) + 1 > build-id


build_postinstall: 
	@esbuild --bundle --format=cjs --platform=node --define:BUN_VERSION="\"$(PACKAGE_JSON_VERSION)\"" packages/bun-cli/scripts/postinstall.ts > packages/bun-cli/postinstall.js

write-package-json-version-cli: 
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' packages/bun-cli/package.json  > packages/bun-cli/package.json.new
	mv packages/bun-cli/package.json.new packages/bun-cli/package.json

write-package-json-version-arch: 
	jq -S --raw-output '.version = "${PACKAGE_JSON_VERSION}"' $(PACKAGE_DIR)/package.json  > $(PACKAGE_DIR)/package.json.new
	mv $(PACKAGE_DIR)/package.json.new $(PACKAGE_DIR)/package.json

tag: 
	git tag $(BUN_BUILD_TAG)
	git push --tags

prepare-release: build_postinstall tag release-create write-package-json-version-arch write-package-json-version-cli

release-create:
	gh release create --title "Bun v$(PACKAGE_JSON_VERSION)" "$(BUN_BUILD_TAG)"

release-cli-push:
	cd packages/bun-cli && npm pack --pack-destination /tmp/
	gh release upload $(BUN_BUILD_TAG) --clobber /tmp/bun-cli-$(PACKAGE_JSON_VERSION).tgz

release-macos-x64-push:
	cd packages/bun-cli-darwin-x64 && npm pack --pack-destination /tmp/
	gh release upload $(BUN_BUILD_TAG) --clobber /tmp/bun-cli-darwin-x64-$(PACKAGE_JSON_VERSION).tgz

jsc-copy-headers:
	find src/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} src/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders/JavaScriptCore \;

jsc-build-mac-compile:
	cd src/javascript/jsc/WebKit && ICU_INCLUDE_DIRS="$(HOMEBREW_PREFIX)opt/icu4c/include" ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo"

jsc-build-linux-compile:
	cd src/javascript/jsc/WebKit && ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo


jsc-build-mac: jsc-build-mac-compile jsc-build-mac-copy

jsc-build-mac-copy:
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libJavaScriptCore.a src/deps/libJavaScriptCore.a
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libWTF.a src/deps/libWTF.a
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libbmalloc.a src/deps/libbmalloc.a
	 
JSC_FILES := src/deps/libJavaScriptCore.a \
	src/deps/libWTF.a \
	src/deps/libbmalloc.a 

HOMEBREW_PREFIX := $(shell brew --prefix)/

SRC_DIR := src/javascript/jsc/bindings
OBJ_DIR := src/javascript/jsc/bindings-obj
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
INCLUDE_DIRS := -Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/WTF/Headers \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/ICU/Headers \
		-Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/ \
		-Isrc/JavaScript/jsc/bindings/ \
		-Isrc/javascript/jsc/WebKit/Source/bmalloc 

CLANG_FLAGS := $(INCLUDE_DIRS) \
		-std=gnu++1z \
		-stdlib=libc++ \
		-DSTATICALLY_LINKED_WITH_JavaScriptCore=1 \
		-DSTATICALLY_LINKED_WITH_WTF=1 \
		-DBUILDING_WITH_CMAKE=1 \
		-DNDEBUG=1 \
		-DNOMINMAX \
		-DIS_BUILD \
		-g \
		-DENABLE_INSPECTOR_ALTERNATE_DISPATCHERS=0 \
		-DBUILDING_JSCONLY__ \
		-DASSERT_ENABLED=0\
		-DDU_DISABLE_RENAMING=1

jsc-bindings-mac: $(OBJ_FILES)


MACOS_ICU_FILES := $(HOMEBREW_PREFIX)opt/icu4c/lib/libicudata.a \
	$(HOMEBREW_PREFIX)opt/icu4c/lib/libicui18n.a \
	$(HOMEBREW_PREFIX)opt/icu4c/lib/libicuuc.a 

MACOS_ICU_INCLUDE := $(HOMEBREW_PREFIX)opt/icu4c/include

MACOS_ICU_FLAGS := -l icucore \
	$(MACOS_ICU_FILES) \
	-I$(MACOS_ICU_INCLUDE)

BUN_LLD_FLAGS := $(OBJ_FILES) \
		${MACOS_ICU_FLAGS} \
		${JSC_FILES} \
		src/deps/picohttpparser.o \
		src/deps/mimalloc/libmimalloc.a \
		$(CLANG_FLAGS) \
		-fpie \

mimalloc:
	cd src/deps/mimalloc; cmake .; make; 

bun-link-lld-debug:
	clang++ $(BUN_LLD_FLAGS) \
		$(DEBUG_BIN)/bun-debug.o \
		-Wl,-dead_strip \
		-ftls-model=local-exec \
		-flto \
		-o $(DEBUG_BIN)/bun-debug

bun-link-lld-release:
	clang++ $(BUN_LLD_FLAGS) \
		$(BIN_DIR)/bun.o \
		-o $(BIN_DIR)/bun \
		-Wl,-dead_strip \
		-ftls-model=local-exec \
		-flto \
		-O3
	rm $(BIN_DIR)/bun.o

bun-link-lld-release-aarch64:
	clang++ $(BUN_LLD_FLAGS) \
		build/macos-aarch64/bun.o \
		-o build/macos-aarch64/bun \
		-Wl,-dead_strip \
		-ftls-model=local-exec \
		-flto \
		-O3

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	clang++ -c -o $@ $< \
		$(CLANG_FLAGS) \
		-O1

sizegen:
	clang++ src/javascript/jsc/headergen/sizegen.cpp -o /tmp/sizegen $(CLANG_FLAGS) -O1
	/tmp/sizegen > src/javascript/jsc/bindings/sizes.zig

picohttp:
	 clang -O3 -g -c src/deps/picohttpparser.c -Isrc/deps -o src/deps/picohttpparser.o; cd ../../	

