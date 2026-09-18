const http = require('node:http');

const server = http.createServer((req, res) => {
  console.log(`JS: Requête reçue ! [${req.method}] ${req.url}`);
  
  if (req.url === '/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from Bun-Elixir Server!' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(4000, () => {
  console.log('JS: Serveur à l\'écoute sur le port 4000');
  
  // Test automatique via fetch
  setTimeout(() => {
      console.log('JS: Test automatique de la requête...');
      fetch('http://localhost:4000/hello')
        .then(r => r.json())
        .then(data => {
            console.log('JS: Résultat du serveur:', data.message);
            if (data.message === 'Hello from Bun-Elixir Server!') {
                console.log('✅ TEST HTTP SERVER RÉUSSI !');
            }
        });
  }, 500);
});
