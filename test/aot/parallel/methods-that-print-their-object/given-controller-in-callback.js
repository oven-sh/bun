new ReadableStream({ start(controller) { console.log(controller); } });
new WritableStream({ start(controller) { console.log(controller); } });
new TransformStream({ start(controller) { console.log(controller); } });
