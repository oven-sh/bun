IO.puts "--- Bun-Next : Test de Node Source (FS) v26 ---"

js_code = """
try {
    const fs = require('./node_source/node-26.0.0/lib/fs.js');
    console.log("✅ FS chargé depuis les sources de Node.js v26 !");
    console.log("FS constants accessibles :", fs.constants !== undefined);
} catch (e) {
    console.log("Erreur :", e);
}
"""

# Le bundler va parser js_code, voir le require() vers le source node
# et l'inclure dans le bundle.
# Pour le test, on va créer un fichier temporaire
File.write!("test_node_source.js", js_code)

case BunNext.Bundler.bundle_and_run("test_node_source.js") do
  result when is_binary(result) ->
    IO.puts "\n✅ Exécution terminée. Retour : #{result}"
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end

File.rm!("test_node_source.js")
