
speedy: speedy-prod-native speedy-prod-wasi speedy-prod-wasm

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

jsc-build-mac:
	cd src/javascript/jsc/WebKit && ICU_INCLUDE_DIRS="/usr/local/opt/icu4c/include" ./Tools/Scripts/build-jsc --jsc-only --cmakeargs="-DENABLE_STATIC_JSC=ON -DCMAKE_BUILD_TYPE=relwithdebinfo" && echo "Ignore the \"has no symbols\" errors"
	 

SRC_DIR := src/javascript/jsc/bindings
OBJ_DIR := src/javascript/jsc/bindings-obj
SRC_FILES := $(wildcard $(SRC_DIR)/*.cpp)
OBJ_FILES := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRC_FILES))
CLANG_FLAGS = -Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/JavaScriptCore/PrivateHeaders \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/WTF/Headers \
		-Isrc/javascript/jsc/WebKit/WebKitBuild/Release/ICU/Headers \
		-DSTATICALLY_LINKED_WITH_JavaScriptCore=1 \
		-DSTATICALLY_LINKED_WITH_WTF=1 \
		-DBUILDING_WITH_CMAKE=1 \
		-DNDEBUG=1 \
		-DNOMINMAX \
		-DIS_BUILD \
		-O3 \
		-g \
		-DENABLE_INSPECTOR_ALTERNATE_DISPATCHERS=0 \
		-DBUILDING_JSCONLY__ \
		-DASSERT_ENABLED=0\
		-Isrc/JavaScript/jsc/WebKit/WebKitBuild/Release/ \
		-Isrc/JavaScript/jsc/bindings/ \
		-Isrc/javascript/jsc/WebKit/Source/bmalloc \
		-std=gnu++1z \
		-stdlib=libc++ \
		-DDU_DISABLE_RENAMING=1 \
		-march=native 

jsc-bindings-mac: $(OBJ_FILES)

# We do this outside of build.zig for performance reasons
# The C compilation stuff with build.zig is really slow and we don't need to run this as often as the rest
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp
	clang++ -c -o $@ $< \
		$(CLANG_FLAGS)

sizegen:
	clang++ src/javascript/jsc/headergen/sizegen.cpp -o /tmp/sizegen $(CLANG_FLAGS)
	/tmp/sizegen > src/javascript/jsc/bindings/sizes.zig


picohttp:
	 clang -O3 -g -c src/deps/picohttpparser.c -Isrc/deps -o src/deps/picohttpparser.o; cd ../../	

speedy-prod-native-macos: picohttp
	zig build -Drelease-fast -Dtarget=x86_64-macos-gnu

speedy-prod-native-macos-lib: 
	zig build lib -Drelease-fast -Dtarget=x86_64-macos-gnu

speedy-m1:
	zig build -Drelease-fast -Dtarget=aarch64-macos-gnu

speedy-prod-wasm: 
	zig build -Drelease-fast -Dtarget=wasm32-freestanding

speedy-prod-wasi: 
	zig build -Drelease-fast -Dtarget=wasm32-wasi

speedy-dev: speedy-dev-native speedy-dev-wasi speedy-dev-wasm

speedy-dev-native: 
	zig build

speedy-dev-wasm: 
	zig build -Dtarget=wasm32-freestanding

speedy-dev-wasi: 
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


bench-rome-speedy: | bench/rome-verify 
	cd bench/rome/src
	/Users/jarred/Code/esdev/build/macos-x86_64/esdev --outdir=dist ./entry.ts

github-rome: 
	mkdir -p github/rome
	cd github/rome && git init && git remote add origin https://github.com/romejs/rome.git
	cd github/rome && git fetch --depth 1 origin d95a3a7aab90773c9b36d9c82a08c8c4c6b68aa5 && git checkout FETCH_HEAD