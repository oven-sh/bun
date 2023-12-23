$Root = (Join-Path $PSScriptRoot "../")

Push-Location (Join-Path $Root "packages\bun-internal-test")
try {
    npm i
    node src\runner.node.mjs
} finally { Pop-Location }