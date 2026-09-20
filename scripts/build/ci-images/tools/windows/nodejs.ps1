Install-Scoop-Package "nodejs@$NODEJS_VERSION"

# node-gyp looks in its cache before it downloads anything: for the user who
# runs this script and for the agent's service account.
$stage = "$env:TEMP\node-headers"
New-Item -ItemType Directory -Force $stage | Out-Null
Download $NODEJS_HEADERS_URL "$stage\headers.tar.gz"
Download $NODEJS_LIB_URL "$stage\node.lib"
Run tar -xzf "$stage\headers.tar.gz" -C $stage --strip-components=1
foreach ($base in $env:LOCALAPPDATA, "$AGENT_HOME\AppData\Local") {
  $cache = "$base\node-gyp\Cache\$NODEJS_VERSION"
  New-Item -ItemType Directory -Force "$cache\$NODEJS_ARCH" | Out-Null
  Copy-Item -Recurse -Force "$stage\include" $cache
  Copy-Item -Force "$stage\node.lib" "$cache\$NODEJS_ARCH\node.lib"
  Set-Content "$cache\installVersion" $NODE_GYP_INSTALL_VERSION
}
Remove-Temp $stage
