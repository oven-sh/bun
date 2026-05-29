IO.puts "--- Bun-Next : Test de la Résolution Réelle (Phase 3) ---"

# Dépendances de test (un petit arbre)
root_deps = %{
  "react" => "^18.2.0"
}

IO.puts "Lancement de la résolution récursive via NPM..."

case BunNext.Resolver.resolve(root_deps) do
  {:ok, solution} ->
    IO.puts "✅ Solution trouvée pour #{Enum.count(solution)} paquets :"
    Enum.each(solution, fn {name, ver} ->
      IO.puts "   - #{name} : #{ver}"
    end)
    
    IO.puts "\n🚀 Démarrage du téléchargement et de l'extraction..."
    BunNext.Downloader.download_packages(solution)
    IO.puts "✅ Installation terminée avec succès."
    
  {:error, reason} ->
    IO.puts "❌ Erreur de résolution : #{reason}"
end

IO.puts "--- Fin du test ---"
