const { Worker } = require('node:worker_threads');

console.log('Main: Démarrage du worker...');
const worker = new Worker('test_js/test-worker-child.js');

worker.on('message', (msg) => {
    console.log('Main: Message reçu du worker:', msg);
    if (msg.type === 'pong') {
        console.log('✅ TEST WORKER THREADS RÉUSSI !');
    }
});

setTimeout(() => {
    console.log('Main: Envoi ping au worker...');
    worker.postMessage({ type: 'ping' });
}, 1000);
