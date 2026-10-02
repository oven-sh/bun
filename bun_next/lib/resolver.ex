defmodule BunNext.Resolver do
  @moduledoc """
  Orchestre la résolution récursive des dépendances en utilisant le registre NPM réel.
  """

  def resolve(root_deps) do
    resolve_recursive(root_deps, %{})
  end

  defp resolve_recursive(root_deps, registry_cache) do
    # 1. S'assurer que les dépendances racines sont dans le cache
    registry_cache = Enum.reduce(root_deps, registry_cache, fn {name, _req}, acc ->
      ensure_in_cache(name, acc)
    end)

    # 2. Appeler Rust pour résoudre
    case BunNext.Native.resolve_deps(root_deps, registry_cache) do
      solution when is_map(solution) ->
        {:ok, solution}

      {:error, reason} ->
        # Utilisation d'un binaire pour le matching
        reason_str = to_string(reason)
        if String.contains?(reason_str, "Paquet inconnu : ") do
          missing_pkg = String.replace(reason_str, "Paquet inconnu : ", "")
          IO.puts "🔄 Paquet manquant détecté : #{missing_pkg}. Récupération..."
          
          new_cache = ensure_in_cache(missing_pkg, registry_cache)
          
          # Si le cache n'a pas bougé, on a un problème (paquet inexistant sur NPM ?)
          if new_cache == registry_cache do
            {:error, "Impossible de trouver le paquet #{missing_pkg} sur NPM."}
          else
            resolve_recursive(root_deps, new_cache)
          end
        else
          {:error, reason_str}
        end
    end
  end

  defp ensure_in_cache(name, cache) do
    if Map.has_key?(cache, name) do
      cache
    else
      IO.puts "🔍 Récupération des métadonnées pour #{name}..."
      case BunNext.fetch_package_metadata(name) do
        {:ok, data} ->
          versions_map = for {v, info} <- data["versions"], into: %{} do
            deps = Map.get(info, "dependencies", %{})
            {v, deps}
          end
          Map.put(cache, name, versions_map)
        _ ->
          cache
      end
    end
  end
end
