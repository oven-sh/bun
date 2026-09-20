Set-Env CARGO_HOME "$RUST_DIR\cargo"
Set-Env RUSTUP_HOME "$RUST_DIR\rustup"

$rustupInit = "$env:TEMP\rustup-init.exe"
Download $RUSTUP_INIT_URL $rustupInit
Run $rustupInit -y --no-modify-path --profile minimal --default-toolchain $RUST_CHANNEL --component $RUST_COMPONENTS --target $RUST_TARGETS
Remove-Temp $rustupInit
Add-To-Path "$RUST_DIR\cargo\bin"
