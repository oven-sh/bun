
bun: bun-prod-native bun-prod-wasi bun-prod-wasm

api: 
	peechy --schema src/api/schema.peechy --esm src/api/schema.js --ts src/api/schema.d.ts --zig src/api/schema.zig

jsc: jsc-build jsc-bindings
jsc-build: jsc-build-mac jsc-copy-headers
jsc-bindings:
	jsc-bindings-headers
	jsc-bindings-mac

jsc-bindings-headers:
	zig build headers

jsc-copy-headers:
	find src/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/Headers/JavaScriptCore/ -name "*.h" -exec cp {} src/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders/JavaScriptCore \;

jsc-build-mac-compile:
	cd src/javascript/jsc/WebKit && ICU_INCLUDE_DIRS="/usr/local/opt/icu4c/include" ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo" && echo "Ignore the \"has no symbols\" errors"

jsc-build-mac: jsc-build-mac-compile jsc-build-mac-copy

jsc-build-mac-copy:
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libJavaScriptCore.a src/deps/libJavaScriptCore.a
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libWTF.a src/deps/libWTF.a
	cp src/JavaScript/jsc/WebKit/WebKitBuild/Release/lib/libbmalloc.a src/deps/libbmalloc.a
	 
JSC_FILES := src/deps/libJavaScriptCore.a \
	src/deps/libWTF.a \
	src/deps/libbmalloc.a 

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

CLANG_FLAGS = 
		$(INCLUDE_DIRS) \
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
		-DDU_DISABLE_RENAMING=1 \
		-march=native 

jsc-bindings-mac: $(OBJ_FILES)

MACOS_ICU_FILES := /usr/local/opt/icu4c/lib/libicudata.a \
	/usr/local/opt/icu4c/lib/libicui18n.a \
	/usr/local/opt/icu4c/lib/libicuuc.a 

MACOS_ICU_INCLUDE := /usr/local/opt/icu4c/include

MACOS_ICU_FLAGS := -l icucore \
	$(MACOS_ICU_FILES) \
	-I$(MACOS_ICU_INCLUDE)

BUN_LLD_FLAGS := $(OBJ_FILES) \
		${MACOS_ICU_FLAGS} \
		${JSC_FILES} \
		src/deps/picohttpparser.o \
		$(CLANG_FLAGS) \
		-fpie \

mimalloc:
	cd src/deps/mimalloc; cmake .; make; 

bun-link-lld-debug:
	clang++ $(BUN_LLD_FLAGS) \
		build/debug/macos-x86_64/bun.o \
		-o build/debug/macos-x86_64/bun		

bun-link-lld-release:
	clang++ $(BUN_LLD_FLAGS) \
		build/macos-x86_64/bun.o \
		/usr/local/lib/mimalloc-1.7/libmimalloc.a \
		-o build/macos-x86_64/bun \
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
	clang++ src/javascript/jsc/headergen/sizegen.cpp -o /tmp/sizegen $(CLANG_FLAGS)
	/tmp/sizegen > src/javascript/jsc/bindings/sizes.zig


picohttp:
	 clang -O3 -g -c src/deps/picohttpparser.c -Isrc/deps -o src/deps/picohttpparser.o; cd ../../	

bun-prod-native-macos: picohttp
	zig build -Drelease-fast -Dtarget=x86_64-macos-gnu

bun-prod-native-macos-lib: 
	zig build lib -Drelease-fast -Dtarget=x86_64-macos-gnu

bun-m1:
	zig build -Drelease-fast -Dtarget=aarch64-macos-gnu

bun-prod-wasm: 
	zig build -Drelease-fast -Dtarget=wasm32-freestanding

bun-prod-wasi: 
	zig build -Drelease-fast -Dtarget=wasm32-wasi

bun-dev: bun-dev-native bun-dev-wasi bun-dev-wasm

bun-dev-native: 
	zig build

bun-dev-wasm: 
	zig build -Dtarget=wasm32-freestanding

bun-dev-wasi: 
	zig build -Dtarget=wasm32-wasi



ROME_TSCONFIG += {
ROME_TSCONFIG +=   \"compilerOptions\": {
ROME_TSCONFIG +=     \"sourceMap\": true,
ROME_TSCONFIG +=     \"esModuleInterop\": true,
ROME_TSCONFIG +=     \"resolveJsonModule\": true,
ROME_TSCONFIG +=     \"moduleResolution\": \"node\",
ROME_TSCONFIG +=     \"target\": \"es2019\",
ROME_TSCONFIG +=     \"module\": \"commonjs\",
ROME_TSCONFIG +=     \"baseUrl\": \".\"
ROME_TSCONFIG +=   }
ROME_TSCONFIG += }

github/rome:
	mkdir -p github/rome
	cd github/rome && git init && git remote add origin https://github.com/romejs/rome.git
	cd github/rome && git fetch --depth 1 origin d95a3a7aab90773c9b36d9c82a08c8c4c6b68aa5 && git checkout FETCH_HEAD

# This target provides an easy way to verify that the build is correct. Since
# Rome is self-hosted, we can just run the bundle to build Rome. This makes sure
# the bundle doesn't crash when run and is a good test of a non-trivial workload.
bench-rome-verify: | github/rome
	mkdir -p bench/rome-verify
	cp -r github/rome/packages bench/rome-verify/packages
	cp github/rome/package.json bench/rome-verify/package.json

bench-rome: 
	rm -rf bench/rome
	mkdir -p bench/rome
	cp -r github/rome/packages bench/rome/src/
	echo "$(ROME_TSCONFIG)" > bench/rome/src/tsconfig.json
	echo 'import "rome/bin/rome"' > bench/rome/src/entry.ts

	# Patch a cyclic import ordering issue that affects commonjs-style bundlers (webpack and parcel)
	echo "export { default as createHook } from './api/createHook';" > .temp
	sed "/createHook/d" bench/rome/src/@romejs/js-compiler/index.ts >> .temp
	mv .temp bench/rome/src/@romejs/js-compiler/index.ts

	# Replace "import fs = require('fs')" with "const fs = require('fs')" because
	# the TypeScript compiler strips these statements when targeting "esnext",
	# which breaks Parcel 2 when scope hoisting is enabled.
	find bench/rome/src -name '*.ts' -type f -print0 | xargs -L1 -0 sed -i '' 's/import \([A-Za-z0-9_]*\) =/const \1 =/g'
	find bench/rome/src -name '*.tsx' -type f -print0 | xargs -L1 -0 sed -i '' 's/import \([A-Za-z0-9_]*\) =/const \1 =/g'

	# Get an approximate line count
	rm -r bench/rome/src/@romejs/js-parser/test-fixtures
	echo 'Line count:' && (find bench/rome/src -name '*.ts' && find bench/rome/src -name '*.js') | xargs wc -l | tail -n 1


bench-rome-bun: | bench/rome-verify 
	cd bench/rome/src
	/Users/jarred/Code/bun/build/macos-x86_64/bun --outdir=dist ./entry.ts

github-rome: 
	mkdir -p github/rome
	cd github/rome && git init && git remote add origin https://github.com/romejs/rome.git
	cd github/rome && git fetch --depth 1 origin d95a3a7aab90773c9b36d9c82a08c8c4c6b68aa5 && git checkout FETCH_HEAD