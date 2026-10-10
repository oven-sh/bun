# Script de test complet pour Bun-Next Phase 1
IO.puts "--- Bun-Next : Test de la Phase 1 ---"

# 1. Parsing du package.json (Rust)
package = BunNext.Native.parse_package_json("../package.json")
IO.puts "Package '#{package.name}' chargé."

# 2. Extraction des dépendances (Elixir)
# On simplifie pour le test : on prend les devDependencies
deps = package.dev_dependencies
       |> Enum.filter(fn {name, ver} -> !String.contains?(ver, ":") end) # On ignore les workspace: et github: pour ce test
       |> Enum.take(5) # On en prend 5 pour le test

IO.puts "Démarrage du téléchargement parallèle de #{Enum.count(deps)} paquets..."

# 3. Téléchargement (Elixir / Req)
BunNext.Downloader.download_packages(deps)

IO.puts "--- Fin du test Bun-Next ---"
