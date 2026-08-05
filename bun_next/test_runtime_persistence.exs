# Test de la persistance du runtime JS
runtime = BunNext.Native.init_runtime()

# Première exécution : définir une variable globale
BunNext.Native.eval_js(runtime, "globalThis.maValeur = 42;")
IO.puts("Valeur définie à 42")

# Deuxième exécution : lire la variable
result = BunNext.Native.eval_js(runtime, "globalThis.maValeur + 8;")
IO.puts("Résultat attendu (50) : #{result}")

if result == "50" do
  IO.puts("✅ Test de persistance réussi !")
else
  IO.puts("❌ Échec du test : reçu #{result}")
  exit({:error, :persistence_failed})
end
