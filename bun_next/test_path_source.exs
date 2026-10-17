IO.puts "--- Bun-Next : Test de Node Source (Path) v26 ---"

js_code = """
try {
    const path = require('./node_source/node-26.0.0/lib/path.js');
    console.log("✅ Path chargé depuis les sources de Node.js v26 !");
    console.log("Extname de test.js :", path.extname('test.js'));
} catch (e) {
    console.log("Erreur :", e);
}
"""

File.write!("test_path_source.js", js_code)

case BunNext.Bundler.bundle_and_run("test_path_source.js") do
  result when is_binary(result) ->
    IO.puts "\n✅ Exécution terminée. Retour : #{result}"
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end

File.rm!("test_path_source.js")
