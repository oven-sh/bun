defmodule BunNext.NodeUpdater do
  @moduledoc """
  Gère la récupération automatique du code source JS officiel de Node.js.
  """

  # On cible une version stable récente pour le prototype. 
  # Pour une vraie automatisation, on interrogerait l'API GitHub pour le dernier tag.
  @node_version "v26.0.0"
  @tarball_url "https://github.com/nodejs/node/archive/refs/tags/#{@node_version}.tar.gz"

  def update do
    dest_dir = "node_source"
    tar_path = "node_source.tar.gz"

    IO.puts "⬇️ Téléchargement du code source de Node.js (#{@node_version})..."
    
    case Req.get!(@tarball_url, output: tar_path) do
      %Req.Response{status: 200} ->
        IO.puts "📦 Extraction de l'archive (cela peut prendre un instant)..."
        File.mkdir_p!(dest_dir)
        
        # On utilise notre propre NIF ultra-rapide !
        case BunNext.Native.extract_tgz(tar_path, dest_dir) do
          {:ok, _} -> 
            IO.puts "✅ Code source de Node.js mis à jour dans #{dest_dir}/node-#{@node_version}/lib"
            File.rm!(tar_path)
            {:ok, "#{dest_dir}/node-#{String.trim_leading(@node_version, "v")}/lib"}
          
          # Si le NIF retourne un string direct (comme c'est le cas actuellement)
          path when is_binary(path) ->
            IO.puts "✅ Code source de Node.js mis à jour dans #{dest_dir}/node-#{String.trim_leading(@node_version, "v")}/lib"
            File.rm!(tar_path)
            {:ok, "#{dest_dir}/node-#{String.trim_leading(@node_version, "v")}/lib"}

          {:error, reason} ->
            IO.puts "❌ Erreur d'extraction : #{reason}"
            {:error, reason}
        end

      _ ->
        IO.puts "❌ Erreur lors du téléchargement."
        {:error, :download_failed}
    end
  end
end
