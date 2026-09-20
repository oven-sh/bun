apk add --no-cache --no-interactive --no-progress python3-dev fuse-dev pkgconf py3-setuptools
dir=$(mktemp -d)
download "$PYTHON_FUSE_URL" "$dir/python-fuse.tar.gz"
tar -xzf "$dir/python-fuse.tar.gz" -C "$dir"
(cd "$dir/python-fuse-$PYTHON_FUSE_VERSION" && python3 setup.py build && python3 setup.py install)
rm -rf "$dir"
echo fuse >> /etc/modules-load.d/fuse.conf
