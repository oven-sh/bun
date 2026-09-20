set_env RUSTUP_HOME "$RUST_DIR"
set_env CARGO_HOME "$RUST_DIR"

dir=$(mktemp -d)
download "$RUSTUP_INIT_URL" "$dir/rustup-init"
chmod +x "$dir/rustup-init"
"$dir/rustup-init" -y --no-modify-path --profile minimal \
  --default-toolchain "$RUST_CHANNEL" --component "$RUST_COMPONENTS" --target "$RUST_TARGETS"
rm -rf "$dir"
add_to_path "$RUST_DIR/bin"
# Builds run as the agent's user, and cargo writes its registry here.
chown -R "$AGENT_USER:$AGENT_USER" "$RUST_DIR"
