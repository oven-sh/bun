dir=$(mktemp -d)
download "$CURL_H3_URL" "$dir/curl.tar.xz"
tar -xJf "$dir/curl.tar.xz" -C "$dir" curl
install -m 755 "$dir/curl" /usr/local/bin/curl-h3
rm -rf "$dir"
set_env CURL_HTTP3 /usr/local/bin/curl-h3

curl-h3 --version | head -n1 | grep -q "curl $CURL_H3_VERSION " || fail "curl-h3 --version is not $CURL_H3_VERSION"
curl-h3 --version | grep -q HTTP3 || fail "curl-h3 has no HTTP3 support"
