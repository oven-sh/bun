# TODO(@paperdave): finalize this script out
$ZigVersion = "0.12.0-dev.1571+03adafd80"

$Url = "https://ziglang.org/builds/zig-windows-x86_64-${ZigVersion}.zip"

Invoke-WebRequest $Url -OutFile .cache\zig-${ZigVersion}.zip
Expand-Archive zig-${ZigVersion}.zip
