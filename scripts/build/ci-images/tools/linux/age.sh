dir=$(mktemp -d)
download "$AGE_URL" "$dir/age.tar.gz"
echo "$AGE_SHA256  $dir/age.tar.gz" | sha256sum -c -
tar -xzf "$dir/age.tar.gz" -C "$dir" age/age
install -m 755 "$dir/age/age" /usr/local/bin/age
rm -rf "$dir"
