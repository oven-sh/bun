IO.puts "--- Bun-Next : Test du Runtime (Boa Engine) ---"

js_code = """
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

const result = factorial(5);
`Resultat du calcul (5!): ${result}`
"""

IO.puts "Exécution du code JavaScript..."
case BunNext.Native.run_js(js_code) do
  result when is_binary(result) ->
    IO.puts "✅ Retour du runtime : #{result}"
  {:error, reason} ->
    IO.puts "❌ Erreur JS : #{reason}"
end

IO.puts "--- Fin du test ---"
