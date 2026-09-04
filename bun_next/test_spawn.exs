# Test de child_process (spawn) via Elixir
{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Démarrage du test spawn...")

# Code JS qui utilise __elixir_spawn
# On teste une commande simple : 'echo' avec des arguments
code = """
const child = __elixir_spawn('cmd', ['/c', 'echo Hello from OS!']);

child.on('stdout', (data) => {
    console.log('JS Received stdout:', data);
    sendToElixir({ type: 'spawn_stdout', data: data.trim() });
});

child.on('close', (code) => {
    console.log('JS Child process exited with code:', code);
    sendToElixir({ type: 'spawn_close', code: code });
});

"Spawned";
"""

BunNext.Runtime.eval(pid, code)

# On attend les messages
results = %{stdout: nil, close: nil}

defmodule TestHelper do
  def wait_messages(results) do
    receive do
      msg ->
        case Jason.decode(msg) do
          {:ok, %{"type" => "spawn_stdout", "data" => data}} ->
            IO.puts("✅ Stdout reçu : #{data}")
            wait_messages(Map.put(results, :stdout, data))
          
          {:ok, %{"type" => "spawn_close", "code" => code}} ->
            IO.puts("✅ Processus fermé (code #{code})")
            Map.put(results, :close, code)

          _ ->
            wait_messages(results)
        end
    after
      5000 ->
        results
    end
  end
end

final_results = TestHelper.wait_messages(results)

if final_results.stdout == "Hello from OS!" and final_results.close == 0 do
  IO.puts("✅ Test Spawn réussi !")
else
  IO.puts("❌ Échec du test : #{inspect(final_results)}")
end
