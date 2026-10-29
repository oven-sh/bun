// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
new ReadableStream({ start(controller) { console.log(controller); } });
new WritableStream({ start(controller) { console.log(controller); } });
new TransformStream({ start(controller) { console.log(controller); } });
