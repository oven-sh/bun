defmodule Mix.Tasks.Bun.Test do
  use Mix.Task

  @shortdoc "Lance la suite de tests de conformité Bun-Elixir"

  def run(args) do
    Mix.Task.run("app.start")
    
    target = List.first(args) || "test_js"
    
    test_files = 
      if File.dir?(target) do
        Path.wildcard("#{target}/**/*.js")
      else
        if File.exists?(target), do: [target], else: []
      end
    
    if Enum.empty?(test_files) do
      IO.puts("Aucun test trouvé pour #{target}")
    else
      IO.puts("🚀 Démarrage de la certification Bun-Elixir...")
      IO.puts("Scanné #{length(test_files)} fichiers de test.\n")

      results = Enum.map(test_files, &run_test_file/1)

      total = length(results)
      successes = results |> Enum.filter(fn {res, _} -> res == :ok end) |> length()
      failures = total - successes

      IO.puts("\n" <> String.duplicate("-", 40))
      IO.puts("RÉSULTATS DE CERTIFICATION")
      IO.puts("Total     : #{total}")
      IO.puts("Succès    : #{successes} ✅")
      IO.puts("Échecs    : #{failures} ❌")
      IO.puts("Score     : #{Float.round(successes / total * 100, 2)}%")
      IO.puts(String.duplicate("-", 40))

      if failures > 0, do: System.halt(1)
    end
  end

  defp run_test_file(path) do
    IO.write("RUN  #{path} ... ")
    
    case BunNext.Bundler.bundle(path) do
      {:ok, code} ->
        {:ok, pid} = BunNext.Runtime.start_link()
        
        # On capture les erreurs d'exécution
        case BunNext.Runtime.eval(pid, code) do
          {:error, reason} ->
            IO.puts("FAIL ❌")
            IO.puts("      => #{reason}")
            {:error, reason}
          _result ->
            IO.puts("PASS ✅")
            {:ok, path}
        end
      {:error, reason} ->
        IO.puts("ERROR ❌ (Bundling)")
        IO.puts("      => #{inspect(reason)}")
        {:error, reason}
    end
  end
end
