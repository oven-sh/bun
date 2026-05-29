defmodule BunNext.CLI do
  @moduledoc """
  Point d'entrée de la ligne de commande pour Bun-Elixir.
  """

  def main(args) do
    IO.puts("Arguments reçus : #{inspect(args)}")
    args
    |> OptionParser.parse(switches: [help: :boolean, version: :boolean], aliases: [h: :help, v: :version])
    |> process()
  end

  defp process({[help: true], _, _}) do
    IO.puts("""
    Bun-Elixir (bun-ex) - Un runtime JS haute performance avec Elixir & Rust

    Usage:
      bun-ex run <fichier.js|ts>
      bun-ex -v | --version
      bun-ex -h | --help

    Commandes:
      run    Exécute un fichier JavaScript ou TypeScript
    """)
  end

  defp process({[version: true], _, _}) do
    IO.puts("bun-ex v0.1.0 (Node.js compatibility v26.0.0)")
  end

  defp process({_, ["run", path], _}) do
    if File.exists?(path) do
      run_file(path)
    else
      IO.puts(:stderr, "Erreur : Le fichier '#{path}' n'existe pas.")
      System.halt(1)
    end
  end

  defp process({_, _, _}) do
    process({[help: true], [], []})
  end

  defp run_file(path) do
    # 1. Bundling & Transpilation
    IO.puts("==> Bundling #{path}...")
    case BunNext.Bundler.bundle(path) do
      {:ok, bundled_code} ->
        # 2. Lancement du Runtime
        {:ok, pid} = BunNext.Runtime.start_link()
        
        # 3. Exécution
        IO.puts("==> Exécution...")
        result = BunNext.Runtime.eval(pid, bundled_code)
        
        # On affiche le résultat final si ce n'est pas "undefined" ou "Done"
        unless result in ["undefined", "\"Done\"", "Done"] do
          IO.puts(result)
        end

        # On attend un peu pour laisser les tâches asynchrones (fetch, spawn) se terminer
        # Dans une version future, on attendrait que la queue de tâches Elixir soit vide.
        Process.sleep(500)
        
      {:error, reason} ->
        IO.puts(:stderr, "Erreur de bundling : #{inspect(reason)}")
        System.halt(1)
    end
  end
end
