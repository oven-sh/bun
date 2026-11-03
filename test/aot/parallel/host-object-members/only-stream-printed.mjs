// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log(new ReadableStream(), new Response("x").body, new TextDecoderStream().readable);
