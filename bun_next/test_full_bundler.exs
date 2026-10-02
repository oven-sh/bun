IO.puts "--- Bun-Next : Test Complet du Bundler ---"

entry_path = "test_bundle/index.js"

case BunNext.Bundler.bundle_and_run(entry_path) do
  result when is_binary(result) ->
    IO.puts "\n✅ Exécution terminée. Retour : #{result}"
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end
