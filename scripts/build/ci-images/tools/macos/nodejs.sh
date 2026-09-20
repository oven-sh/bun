dir=$(mktemp -d)
download "$NODEJS_URL" "$dir/node.tar.gz"
tar -xzf "$dir/node.tar.gz" -C "$dir" --strip-components=1
sudo mkdir -p /usr/local/bin /usr/local/lib /usr/local/include
sudo cp -R "$dir/bin/." /usr/local/bin/
sudo cp -R "$dir/lib/node_modules" /usr/local/lib/
sudo cp -R "$dir/include/node" /usr/local/include/

download "$NODEJS_HEADERS_URL" "$dir/headers.tar.gz"
mkdir "$dir/headers"
tar -xzf "$dir/headers.tar.gz" -C "$dir/headers" --strip-components=1
sudo cp -R "$dir/headers/include/." /usr/local/include/

# node-gyp looks here before it downloads anything.
gyp="$HOME/Library/Caches/node-gyp/$NODEJS_VERSION"
mkdir -p "$gyp"
cp -R "$dir/headers/include" "$gyp/include"
echo "$NODE_GYP_INSTALL_VERSION" > "$gyp/installVersion"
rm -rf "$dir"
add_to_path /usr/local/bin
