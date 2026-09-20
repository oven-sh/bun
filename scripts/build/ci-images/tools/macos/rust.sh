# A home every user of the machine can use: a bare host runs its jobs as
# another user than the one that sets it up.
sudo mkdir -p /opt/rust
sudo chown "$(id -un)" /opt/rust
set_env RUSTUP_HOME /opt/rust
set_env CARGO_HOME /opt/rust

dir=$(mktemp -d)
download "$RUSTUP_INIT_URL" "$dir/rustup-init"
chmod +x "$dir/rustup-init"
"$dir/rustup-init" -y --no-modify-path --profile minimal \
  --default-toolchain "$RUST_CHANNEL" --component "$RUST_COMPONENTS" --target "$RUST_TARGETS"
rm -rf "$dir"
add_to_path /opt/rust/bin
sudo chmod -R a+rwX /opt/rust
