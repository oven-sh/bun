dir=$(mktemp -d)
bun "$BAKE_DIR/xmac.mjs" splat --accept-license --sdk-only \
  --release "$MACOS_CLT_RELEASE" --sdk "$MACOS_SDK_VERSION" --output "$dir" --cache-dir "$dir/cache" > /dev/null
mkdir -p /opt/macos-sdk
mv "$dir/SDKs/MacOSX$MACOS_SDK_VERSION.sdk" /opt/macos-sdk/
rm -rf "$dir"
