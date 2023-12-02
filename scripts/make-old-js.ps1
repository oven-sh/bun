$npm_client = "npm"

& ${npm_client} i

$root = Join-Path (Split-Path -Path $MyInvocation.MyCommand.Definition -Parent) "..\"
$esbuild = Join-Path $root "node_modules\.bin\esbuild"

$env:NODE_ENV = "production"

# runtime.js
& ${esbuild} "--define:process.env.NODE_ENV=`"production`"" --target=esnext  --bundle src/runtime/index.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.js
Add-Content src/runtime.out.js (Get-Content src/runtime.footer.js)
& ${esbuild} "--define:process.env.NODE_ENV=`"production`"" --target=esnext  --bundle src/runtime/index-with-refresh.ts --format=iife --platform=browser --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.out.refresh.js
Add-Content src/runtime.out.refresh.js (Get-Content src/runtime.footer.with-refresh.js)
& ${esbuild} "--define:process.env.NODE_ENV=`"production`"" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.node.pre.out.js
Add-Content src/runtime.node.out.js (Get-Content src/runtime.node.pre.out.js)
Add-Content src/runtime.node.out.js (Get-Content src/runtime.footer.node.js)
& ${esbuild} "--define:process.env.NODE_ENV=`"production`"" --target=esnext  --bundle src/runtime/index-without-hmr.ts --format=iife --platform=node --global-name=BUN_RUNTIME --minify --external:/bun:* > src/runtime.bun.pre.out.js
Add-Content src/runtime.bun.out.js (Get-Content src/runtime.node.pre.out.js)
Add-Content src/runtime.bun.out.js (Get-Content src/runtime.footer.node.js)

# fallback_decoder
& ${esbuild} --target=esnext  --bundle src/fallback.ts --format=iife --platform=browser --minify > src/fallback.out.js

# bun-error
Push-Location packages\bun-error
& ${npm_client} install
& ${npm_client} run build
Pop-Location

# node-fallbacks
Push-Location src\node-fallbacks
& ${npm_client} install
& ${esbuild} --bundle @(Get-Item .\*.js) --outdir=out --format=esm --minify --platform=browser
Pop-Location
