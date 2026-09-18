// Test CLI Bun-Elixir
console.log('--- Hello from Bun-Elixir CLI ---');

const fs = internalBinding('fs');
const os = process.platform;

console.log('Operating System:', os);
console.log('Node version target:', process.version);

fetch('https://jsonplaceholder.typicode.com/posts/1')
  .then(r => r.json())
  .then(data => {
    console.log('Network OK - Post title:', data.title);
  });
