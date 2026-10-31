IO.puts "--- Bun-Next : Test de Syscall Rust Direct ---"

js_code = """
try {
    console.log("DEMARRAGE DU TEST");
    
    // Appel direct au syscall injecté en Rust
    const content = globalThis.__rust_fs.read('../GEMINI.md');
    
    console.log("LECTURE REUSSIE !");
    console.log("PREMIERS CARACTERES :");
    console.log(content.substring(0, 50));
} catch (e) {
    console.log("ERREUR JS:", e);
}
"""

IO.puts "Exécution du runtime..."
case BunNext.Native.run_js(js_code) do
  result when is_binary(result) ->
    IO.puts "\n✅ Fin de l'exécution."
  {:error, reason} ->
    IO.puts "\n❌ Erreur : #{reason}"
end
