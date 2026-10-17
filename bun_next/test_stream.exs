# Test du streaming réel des processus
IO.puts("Démarrage du test de streaming...")

# On utilise la tâche Mix qu'on a créée précédemment
# Mais on veut capturer les messages asynchrones
# Donc on va démarrer le Runtime manuellement dans ce script pour avoir le contrôle

{:ok, pid} = BunNext.Runtime.start_link()

code = File.read!("test_stream.js")
BunNext.Runtime.eval(pid, code)

chunks = []

defmodule StreamHelper do
  def wait_stream(chunks) do
    receive do
      msg ->
        case Jason.decode(msg) do
          {:ok, %{"type" => "stream_chunk", "data" => data}} ->
            IO.puts("CHUNK reçu côté Elixir : #{data}")
            wait_stream([data | chunks])
          
          {:ok, %{"type" => "stream_done", "code" => code}} ->
            IO.puts("FIN du stream (code #{code})")
            Enum.reverse(chunks)

          _ ->
            wait_stream(chunks)
        end
    after
      5000 ->
        IO.puts("TIMEOUT")
        Enum.reverse(chunks)
    end
  end
end

final_chunks = StreamHelper.wait_stream(chunks)

if "Chunk1" in final_chunks and "Chunk2" in final_chunks do
  IO.puts("✅ Test de Streaming réussi !")
else
  IO.puts("❌ Échec du test : #{inspect(final_chunks)}")
end
