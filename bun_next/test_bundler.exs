IO.puts "--- Bun-Next : Test de la Phase 5 (Bundler & Transpilation) ---"

ts_code = """
interface User {
  id: number;
  name: string;
}

function greet(user: User) {
  return `Hello, ${user.name}! (ID: ${user.id})`;
}

const user: User = { id: 1, name: "Bun-Next-User" };
console.log(greet(user));
"""

IO.puts "Code TypeScript à transpiler :"
IO.puts "----------------"
IO.puts ts_code
IO.puts "----------------"

IO.puts "Transpilation via Rust (SWC)..."

case BunNext.Native.transpile_ts(ts_code) do
  js_code ->
    IO.puts "✅ Code JavaScript généré :"
    IO.puts "----------------"
    IO.puts js_code
    IO.puts "----------------"
end

IO.puts "--- Fin du test ---"
