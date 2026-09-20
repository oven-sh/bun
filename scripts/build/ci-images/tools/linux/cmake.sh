dir=$(mktemp -d)
download "$CMAKE_URL" "$dir/cmake.sh"
sh "$dir/cmake.sh" --skip-license --prefix=/usr
rm -rf "$dir"

cmake --version | head -n1 | grep -q "version $CMAKE_VERSION\$" || fail "cmake --version is not $CMAKE_VERSION"
