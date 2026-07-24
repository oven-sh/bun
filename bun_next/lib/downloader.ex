defmodule BunNext.Downloader do
  @moduledoc """
  Gère le téléchargement parallèle des paquets NPM.
  """

  def download_packages(packages) do
    packages
    |> Task.async_stream(fn {name, version} ->
      download_package(name, version)
    end, max_concurrency: 20)
    |> Enum.to_list()
  end

  defp download_package(name, version) do
    clean_version = String.replace(version, ~r/^[\^~]/, "")
    url = "https://registry.npmjs.org/#{name}/-/#{basename(name)}-#{clean_version}.tgz"

    # On utilise decode_body: false pour garder le flux binaire brut (iodata)
    case Req.get(url, decode_body: false) do
      {:ok, %{status: 200, body: body}} ->
        # On convertit l'iodata (liste de chunks) en un binaire unique
        binary_data = IO.iodata_to_binary(body)

        path = BunNext.Native.save_to_cache(name, clean_version, binary_data)
        
        # Extraction dans node_modules
        dest_dir = "node_modules/#{name}"
        File.mkdir_p!(dest_dir)
        BunNext.Native.extract_tgz(path, dest_dir)
        
        _size = byte_size(binary_data)
        IO.puts "✅ #{name}@#{clean_version} extrait dans #{dest_dir}"
        {:ok, name, path}

      {:ok, %{status: status}} ->
        IO.puts "❌ Erreur #{status} pour #{name}@#{clean_version}"
        {:error, status}
      {:error, reason} ->
        IO.puts "❌ Erreur réseau pour #{name}: #{inspect reason}"
        {:error, reason}
    end
  end

  defp basename(name) do
    if String.contains?(name, "/") do
      List.last(String.split(name, "/"))
    else
      name
    end
  end
end
