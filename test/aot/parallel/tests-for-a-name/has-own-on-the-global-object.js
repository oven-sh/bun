const wanted = JSON.parse('["fetch","ReadableStream","TextDecoderStream","CompressionStream","BroadcastChannel","nothing"]');
for (const word of wanted) console.log(word, Object.hasOwn(globalThis, word));
console.log("end");
