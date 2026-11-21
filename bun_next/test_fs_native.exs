IO.puts "--- Bun-Next : Test de Bibliothèque Standard Native ---"

# On crée un module fs léger qui pointe vers notre fs_native.js
# Ou plus simple : on l'injecte directement via Elixir pour le test
fs_js = File.read!("lib/fs_native.js")

js_code = """
// Injection manuelle de notre module fs natif pour le test
globalThis.__builtin_modules['fs'] = (function() {
  const exports = {};
  const module = { exports };
  const require = globalThis.require;
  #{fs_js}
  return module.exports;
})();

try {
    const fs = require('fs');
    console.log("✅ Module fs (Fast-FS) chargé !");
    
    const content = fs.readFileSync('GEMINI.md', 'utf8');
    console.log("LECTURE REUSSIE. Aperçu :");
    console.log(content.substring(0, 50) + "...");
} catch (e) {
    console.log("ERREUR:", e);
}
"""

IO.puts "Exécution du runtime..."
case BunNext.Native.run_js(js_code) do
  result when is_binary(result) ->
    IO.puts "\n✅ Fin de l'exécution."
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end
