// Test de streaming des processus
const child = __elixir_spawn('cmd', ['/c', 'echo Chunk1 && timeout /t 1 > nul && echo Chunk2']);

child.on('stdout', (data) => {
    console.log('JS Received chunk:', data.trim());
    sendToElixir({ type: 'stream_chunk', data: data.trim() });
});

child.on('close', (code) => {
    console.log('JS Process closed');
    sendToElixir({ type: 'stream_done', code: code });
});
