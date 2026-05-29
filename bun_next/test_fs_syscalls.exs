# Test des syscalls FS (Phase 12)
{:ok, pid} = BunNext.Runtime.start_link()

IO.puts("Démarrage du test FS syscalls...")

code = """
const fs = internalBinding('fs');
const testDir = 'test_dir_syscall';
const testFile = testDir + '/hello.txt';
const content = 'Hello from Bun-Elixir Phase 12!';

try {
    // 1. Créer un répertoire
    fs.mkdir(testDir);
    console.log('JS: Dossier créé');

    // 2. Écrire un fichier
    fs.writeFileUtf8(testFile, content);
    console.log('JS: Fichier écrit');

    // 3. Lire le fichier
    const readContent = fs.readFileUtf8(testFile);
    console.log('JS: Contenu lu :', readContent);

    if (readContent === content) {
        sendToElixir({ type: 'fs_test_result', status: 'success' });
    } else {
        sendToElixir({ type: 'fs_test_result', status: 'fail', detail: 'Content mismatch' });
    }
} catch (e) {
    sendToElixir({ type: 'fs_test_result', status: 'error', detail: e.message });
}
"Done";
"""

BunNext.Runtime.eval(pid, code)

receive do
  msg ->
    case Jason.decode(msg) do
      {:ok, %{"type" => "fs_test_result", "status" => "success"}} ->
        IO.puts("✅ Test FS Syscalls réussi !")
      
      {:ok, %{"type" => "fs_test_result", "status" => "fail", "detail" => detail}} ->
        IO.puts("❌ Échec du test FS : #{detail}")

      {:ok, %{"type" => "fs_test_result", "status" => "error", "detail" => detail}} ->
        IO.puts("❌ Erreur pendant le test FS : #{detail}")

      _ ->
        IO.puts("Message inattendu : #{msg}")
    end
after
  5000 ->
    IO.puts("❌ Timeout : aucun résultat de test FS reçu.")
end

# Nettoyage
File.rm_rf!("test_dir_syscall")
