IO.puts("--- Bun-Next : Test d'intégration de l'API Stream ---")

{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Bundling de test_stream_api.js...")
case BunNext.Bundler.bundle("test_stream_api.js") do
  {:ok, bundle_code} ->
    IO.puts("Évaluation du bundle...")
    BunNext.Runtime.eval(pid, bundle_code)

    # Définition de l'attente
    wait_for_result = fn ->
      receive do
        msg when is_binary(msg) ->
          case Jason.decode(msg) do
            {:ok, %{"type" => "stream_test_done", "success" => true}} ->
              IO.puts("✅ Test d'intégration des Streams RÉUSSI !")
              System.halt(0)

            {:ok, %{"type" => "stream_test_done", "success" => false}} ->
              IO.puts("❌ Test d'intégration des Streams ÉCHOUÉ (succès = false)")
              System.halt(1)

            _ ->
              # Continuer à écouter les autres messages
              nil
          end
        _ ->
          nil
      end
    end

    # Boucle d'écoute pour laisser le temps aux nextTick de s'exécuter
    # et d'envoyer le message final.
    for _ <- 1..10 do
      wait_for_result.()
      Process.sleep(100)
    end

    IO.puts("❌ Test d'intégration des Streams ÉCHOUÉ (Timeout ou pas de réponse)")
    System.halt(1)

  {:error, reason} ->
    IO.puts("❌ Erreur de bundling : #{inspect(reason)}")
    System.halt(1)
end
