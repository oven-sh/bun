IO.puts "--- Bun-Next : Test de Syscall fs.readFileSync Réel ---"

js_code = """
const fs = require("./node_source/node-26.0.0/lib/fs.js");
const content = fs.readFileSync("GEMINI.md", "utf8");
console.log("READ_SUCCESS");
console.log(content.substring(0, 20));
"""

File.write!("test_fs_real.js", js_code)

case BunNext.Bundler.bundle_and_run("test_fs_real.js") do
  result when is_binary(result) ->
    IO.puts "\n✅ Exécution terminée."
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end

File.rm!("test_fs_real.js")
