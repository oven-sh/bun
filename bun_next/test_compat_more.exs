IO.puts("--- Bun-Next : Test d'intégration des Nouveaux Modules Compat ---")

{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Bundling de test_compat_more.js...")
case BunNext.Bundler.bundle("test_compat_more.js") do
  {:ok, bundle_code} ->
    IO.puts("Évaluation du bundle...")
    res = BunNext.Runtime.eval(pid, bundle_code)
    IO.puts("Résultat d'évaluation : #{inspect(res)}")
    System.halt(0)

  {:error, reason} ->
    IO.puts("❌ Erreur de bundling : #{inspect(reason)}")
    System.halt(1)
end
