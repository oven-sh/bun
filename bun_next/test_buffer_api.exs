IO.puts("--- Bun-Next : Test d'intégration de l'API Buffer / Crypto / Util ---")

{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Bundling de test_buffer_api.js...")
case BunNext.Bundler.bundle("test_buffer_api.js") do
  {:ok, bundle_code} ->
    IO.puts("Évaluation du bundle...")
    res = BunNext.Runtime.eval(pid, bundle_code)
    IO.puts("Résultat d'évaluation : #{inspect(res)}")

    # Définition de l'attente
    wait_for_result = fn ->
      receive do
        msg when is_binary(msg) ->
          case Jason.decode(msg) do
            {:ok, %{"type" => "buffer_test_done", "success" => true}} ->
              IO.puts("✅ Test d'intégration Buffer/Crypto/Util RÉUSSI !")
              System.halt(0)

            {:ok, %{"type" => "buffer_test_done", "success" => false}} ->
              IO.puts("❌ Test d'intégration Buffer/Crypto/Util ÉCHOUÉ (succès = false)")
              System.halt(1)

            _ ->
              nil
          end
        _ ->
          nil
      end
    end

    # Boucle d'écoute
    for _ <- 1..10 do
      wait_for_result.()
      Process.sleep(100)
    end

    IO.puts("❌ Test d'intégration Buffer/Crypto/Util ÉCHOUÉ (Timeout ou pas de réponse)")
    System.halt(1)

  {:error, reason} ->
    IO.puts("❌ Erreur de bundling : #{inspect(reason)}")
    System.halt(1)
end
