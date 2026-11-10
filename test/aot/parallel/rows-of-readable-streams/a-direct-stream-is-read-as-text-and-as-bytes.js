const make = () => new ReadableStream({ type: "direct", pull(controller) { controller.write("made up"); controller.end(); } });
console.log(`${await make().text()} ${(await make().bytes()).length} ${(await new Response(make()).arrayBuffer()).byteLength}`);
const reader = make().getReader();
const { value, done } = await reader.read();
console.log(`${value.length} ${done}`);
