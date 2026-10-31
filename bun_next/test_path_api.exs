IO.puts "--- Bun-Next : Test du Bundler avec node:path ---"

js_code = """
const path = require('node:path');
console.log('Basename:', path.basename('C:/Users/alpha/test.js'));
console.log('Dirname:', path.dirname('C:/Users/alpha/test.js'));
'Path Test OK'
"""

case BunNext.Native.run_js(js_code) do
  result when is_binary(result) -> IO.puts "✅ #{result}"
  {:error, reason} -> IO.puts "❌ #{reason}"
end
