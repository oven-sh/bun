# Script de test pour Bun-Next
IO.puts "Chargement de Bun-Next..."

# Appels NIF
package = BunNext.Native.parse_package_json("../package.json")

IO.puts "--- Package JSON Parsé par Rust ---"
IO.puts "Nom : #{package.name}"
IO.puts "Version : #{package.version}"
IO.puts "Nombre de devDependencies : #{Enum.count(package.dev_dependencies)}"
IO.inspect package.dev_dependencies
IO.puts "-----------------------------------"
