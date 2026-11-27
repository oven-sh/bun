const { parentPort } = require('node:worker_threads');

console.log('Worker: Initialisé et en attente...');

parentPort.on('message', (msg) => {
    console.log('Worker: Message reçu du parent:', msg);
    if (msg.type === 'ping') {
        console.log('Worker: Envoi pong au parent...');
        parentPort.postMessage({ type: 'pong' });
    }
});
