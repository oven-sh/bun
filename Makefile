
bun: vendor bun-prod-native bun-prod-wasi bun-prod-wasm

vendor: api node-fallbacks runtime_js fallback_decoder mimalloc picohttp jsc

build-obj: 
	zig build obj -Drelease-safe

sign-macos-x64: 
	gon sign-macos-x64.json

sign-macos-aarch64: 
	gon sign.macos-aarch64.json

release-macos-x64: build-obj jsc-bindings-mac bun-link-lld-release sign-macos-x64
release-macos-aarch64: build-obj jsc-bindings-mac bun-link-lld-release sign-macos-aarch64

api: 
	npm install; ./node_modules/.bin/peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig

node-fallbacks: 
	cd src/node-fallbacks; npm install; npm run --silent build

fallback_decoder:
	esbuild --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

runtime_js:
	esbuild --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify > src/runtime.out.js; cat src/runtime.footer.js >> src/runtime.out.js

jsc: jsc-build jsc-bindings
jsc-build: jsc-build-mac jsc-copy-headers
jsc-bindings: jsc-bindings-headers jsc-bindings-mac
	
	

jsc-bindings-headers:
	mkdir -p src/JavaScript/jsc/bindings-obj/
	zig build headers

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
		build/debug/macos-x86_64/bun.o \
		-Wl,-dead_strip \
		-ftls-model=local-exec \
		-flto \
		-o build/debug/macos-x86_64/bun

bun-link-lld-release:
	clang++ $(BUN_LLD_FLAGS) \
		build/macos-x86_64/bun.o \
		-o build/macos-x86_64/bun \
		-Wl,-dead_strip \
		-ftls-model=local-exec \
		-flto \
		-O3

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
