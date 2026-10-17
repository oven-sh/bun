IO.puts "--- Bun-Next : Test de la Phase 4 (Résolution de Dépendances) ---"

# 1. Simuler un registre NPM
registry = %{
  "react" => %{
    "18.2.0" => %{"loose-envify" => "^1.1.0"},
    "18.3.1" => %{"loose-envify" => "^1.4.0"}
  },
  "loose-envify" => %{
    "1.1.0" => %{"js-tokens" => "^3.0.0"},
    "1.4.0" => %{"js-tokens" => "^4.0.0"}
  },
  "js-tokens" => %{
    "3.0.0" => %{},
    "4.0.0" => %{}
  }
}

# 2. Dépendances racines
root_deps = %{
  "react" => "^18.0.0"
}

IO.puts "Lancement de la résolution récursive (Rust + Semver)..."

# Appel du NIF
solution = BunNext.Native.resolve_deps(root_deps, registry)

IO.puts "✅ Solution trouvée :"
Enum.each(solution, fn {name, ver} ->
  IO.puts "   - #{name} : #{ver}"
end)

IO.puts "--- Fin du test ---"
