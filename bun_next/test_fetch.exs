# Test de Fetch complet via Elixir
{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Démarrage du test fetch...")

# Code JS qui utilise fetch
code = """
fetch('https://jsonplaceholder.typicode.com/todos/1')
  .then(response => response.json())
  .then(data => {
    console.log('JS: Données reçues !');
    sendToElixir({ type: 'fetch_result', data: data });
  })
  .catch(err => {
    sendToElixir({ type: 'fetch_error', error: err.message });
  });
"Done";
"""

BunNext.Runtime.eval(pid, code)

# On attend le résultat via le pont de message
receive do
  msg ->
    case Jason.decode(msg) do
      {:ok, %{"type" => "fetch_result", "data" => data}} ->
        IO.puts("✅ Test Fetch réussi !")
        IO.inspect(data, label: "Données reçues d'Elixir")
      
      {:ok, %{"type" => "fetch_error", "error" => err}} ->
        IO.puts("❌ Erreur Fetch : #{err}")

      _ ->
        IO.puts("Message inattendu : #{msg}")
    end
after
  5000 ->
    IO.puts("❌ Timeout : aucun résultat de fetch reçu.")
end
