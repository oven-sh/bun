IO.puts "--- Bun-Next : Test Complet Node APIs ---"

js_code = """
console.log('--- Test Console ---');
console.log('Hello', 'from', 'Bun-Next!');

console.log('\\n--- Test Process ---');
console.log('Platform:', process.platform);
console.log('Version:', process.version);

console.log('\\n--- Test Modules node: ---');
const fs = require('node:fs');
const os = require('os');

console.log('OS Platform:', os.platform());

// Test lecture de fichier
const packageJson = fs.readFileSync('../package.json');
console.log('Contenu de package.json (aperçu):', packageJson.substring(0, 50) + '...');

'Test Terminé'
"""

temp_file = "test_node_apis_temp.js"
File.write!(temp_file, js_code)

case BunNext.Bundler.bundle_and_run(temp_file) do
  result when is_binary(result) ->
    File.rm!(temp_file)
    IO.puts "\n✅ Résultat final : #{result}"
  {:error, reason} ->
    File.rm!(temp_file)
    IO.puts "\n❌ Erreur JS : #{reason}"
end

