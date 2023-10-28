cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
bash ./update-submodules.sh
bash ./all-dependencies.sh

cd ../

bun i

make all-js

mkdir build
cmake -B build -S . -DCMAKE_BUILD_TYPE=Debug -G Ninja
ninja -C build