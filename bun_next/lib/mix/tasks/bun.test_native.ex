defmodule Mix.Tasks.Bun.TestNative do
  use Mix.Task

  @shortdoc "Teste le chargement d'un module natif"

  def run(_) do
    Mix.Task.run("app.start")
    
    # Chemin vers la DLL compilée
    dll_path = Path.expand("target/release/native_test_module.dll")
    
    {:ok, pid} = BunNext.Runtime.start_link()
    
    IO.puts("==> Chargement du module natif...")
    try do
      msg = BunNext.Native.load_native_module(GenServer.call(pid, :get_runtime), dll_path)
      IO.puts("✅ #{msg}")
      
      IO.puts("==> Appel de la fonction native depuis JS...")
      result = BunNext.Runtime.eval(pid, "helloNative()")
      IO.puts("JS Result: #{result}")
      
      if result == "Hello from the N-API Native Module!" do
        IO.puts("🎉 TEST N-API RÉUSSI !")
      else
        IO.puts("❌ Échec : résultat inattendu.")
      end
    rescue
      e -> IO.puts("❌ Erreur de chargement : #{inspect(e)}")
    end
  end
end
