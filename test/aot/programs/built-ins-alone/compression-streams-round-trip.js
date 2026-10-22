const packed = new Blob(["hello"]).stream().pipeThrough(new CompressionStream("gzip"));
console.log((await new Response(packed.pipeThrough(new DecompressionStream("gzip"))).text()).length);
