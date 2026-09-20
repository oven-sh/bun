dir=$(mktemp -d)
download "$CURL_H3_URL" "$dir/curl.tar.xz"
tar -xJf "$dir/curl.tar.xz" -C "$dir" curl
sudo mkdir -p /usr/local/bin
sudo install -m 755 "$dir/curl" /usr/local/bin/curl-h3
rm -rf "$dir"
set_env CURL_HTTP3 /usr/local/bin/curl-h3
