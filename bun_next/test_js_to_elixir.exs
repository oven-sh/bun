# Test de communication JS -> Elixir
runtime = BunNext.Native.init_runtime()

# On exécute du code JS qui appelle sendToElixir
BunNext.Native.eval_js(runtime, "sendToElixir({ type: 'hello', value: 'world' });")

# On attend le message côté Elixir
receive do
  msg ->
    IO.puts("Message reçu d'Elixir : #{msg}")
    case Jason.decode(msg) do
      {:ok, %{"type" => "hello", "value" => "world"}} ->
        IO.puts("✅ Test de communication JS -> Elixir réussi !")
      _ ->
        IO.puts("❌ Message malformé : #{msg}")
    end
after
  2000 ->
    IO.puts("❌ Timeout : aucun message reçu.")
end
