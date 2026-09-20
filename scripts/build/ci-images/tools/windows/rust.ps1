$rust = "$env:ProgramFiles\Rust"
Set-Env CARGO_HOME "$rust\cargo"
Set-Env RUSTUP_HOME "$rust\rustup"

$rustupInit = "$env:TEMP\rustup-init.exe"
Download $RUSTUP_INIT_URL $rustupInit
Run $rustupInit -y --no-modify-path --profile minimal --default-toolchain $RUST_CHANNEL --component $RUST_COMPONENTS --target $RUST_TARGETS
Remove-Item $rustupInit
Add-To-Path "$rust\cargo\bin"

$active = rustup show active-toolchain
if ($active -notmatch "^$([regex]::Escape($RUST_CHANNEL))-") { Fail "the active toolchain is '$active', expected $RUST_CHANNEL" }
