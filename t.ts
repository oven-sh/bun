const ws = new WebSocket(`wss://gateway.discord.gg/?v=10&encoding=json`);
ws.addEventListener('message', msg => {
    console.log(msg.source);
});