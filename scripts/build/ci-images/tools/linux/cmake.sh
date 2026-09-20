dir=$(mktemp -d)
download "$CMAKE_URL" "$dir/cmake.sh"
sh "$dir/cmake.sh" --skip-license --prefix=/usr
rm -rf "$dir"
