defmodule Mix.Tasks.Bun.Run do
  use Mix.Task

  @shortdoc "Exécute un fichier JS ou TS avec Bun-Elixir"

  @moduledoc """
  Exécute un fichier JavaScript ou TypeScript en utilisant le runtime Bun-Elixir.
  Le fichier est automatiquement bundlé et transpilé avant exécution.

  ## Usage
      mix bun.run path/to/file.js
  """

  def run([path | _]) do
    # On s'assure que l'application est démarrée (pour charger les NIFs)
    Mix.Task.run("app.start")

    if File.exists?(path) do
      run_file(path)
    else
      IO.puts(:stderr, "Erreur : Le fichier '#{path}' n'existe pas.")
      System.halt(1)
    end
  end

  def run(_) do
    IO.puts("""
    Usage:
      mix bun.run <fichier.js|ts>
    """)
  end

  defp run_file(path) do
    IO.puts("==> Bundling #{path}...")
    case BunNext.Bundler.bundle(path) do
      {:ok, bundled_code} ->
        # Lancement du Runtime
        {:ok, pid} = BunNext.Runtime.start_link()
        
        # Exécution
        IO.puts("==> Exécution...")
        case BunNext.Runtime.eval(pid, bundled_code) do
          {:error, reason} ->
            IO.puts(:stderr, "❌ Erreur d'exécution JS : #{reason}")
          result ->
            unless result in ["undefined", "\"Done\"", "Done"] do
              IO.puts(result)
            end
        end

        # Attente pour les tâches asynchrones
        Process.sleep(3000)
        
      {:error, reason} ->
        IO.puts(:stderr, "Erreur de bundling : #{inspect(reason)}")
        System.halt(1)
    end
  end
end
