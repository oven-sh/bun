dir=$(mktemp -d)
download "$CHROME_DEB_URL" "$dir/chrome.deb"
apt-get install --yes "$dir/chrome.deb"
rm -rf "$dir"
