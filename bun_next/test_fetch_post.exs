# Test de Fetch POST amélioré
{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Démarrage du test fetch POST...")

# Code JS qui utilise fetch avec POST et headers
code = """
fetch('https://jsonplaceholder.typicode.com/posts', {
    method: 'POST',
    body: JSON.stringify({
        title: 'foo',
        body: 'bar',
        userId: 1
    }),
    headers: {
        'Content-type': 'application/json; charset=UTF-8'
    }
})
  .then(response => response.json())
  .then(data => {
    console.log('JS: POST réussi !');
    sendToElixir({ type: 'fetch_post_result', data: data });
  })
  .catch(err => {
    sendToElixir({ type: 'fetch_post_error', error: err.message });
  });
"Done";
"""

BunNext.Runtime.eval(pid, code)

# On attend le résultat
receive do
  msg ->
    case Jason.decode(msg) do
      {:ok, %{"type" => "fetch_post_result", "data" => data}} ->
        IO.puts("✅ Test Fetch POST réussi !")
        IO.inspect(data, label: "Réponse du serveur")
      
      {:ok, %{"type" => "fetch_post_error", "error" => err}} ->
        IO.puts("❌ Erreur Fetch POST : #{err}")

      _ ->
        IO.puts("Message inattendu : #{msg}")
    end
after
  5000 ->
    IO.puts("❌ Timeout : aucun résultat de fetch POST reçu.")
end
