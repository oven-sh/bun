# Web Streams — pre-rewrite baseline (debug bun-debug 1.4.0, main @ d816daf479da, 2026-07-01)

JS heap object counts + bytes per construction, measured with bun:jsc heapStats over N=20000, after Bun.gc(true)x2. Object COUNTS are build-mode independent.

```
== new ReadableStream({start,pull,cancel}) ==
{"objsPer":17,"heapBytesPer":964,"perStream":{"Function":6,"Promise":1,"Object":4.01,"Array":1,"ReadableStreamDefaultController":1,"ReadableStream":1}}
== new ReadableStream() + getReader() ==
{"objsPer":26,"heapBytesPer":1263,"perStream":{"Function":5,"Object":6.01,"Promise":2,"ReadableStreamDefaultController":1,"ReadableStream":1,"Array":3,"JSLexicalEnvironment":1,"ReadableStreamDefaultReader":1}}
== new WritableStream({write(){}}) ==
{"objsPer":30,"heapBytesPer":1314,"perStream":{"Function":9,"Object":5.01,"Promise":1,"Array":2,"JSLexicalEnvironment":7,"WritableStreamDefaultController":1,"WritableStream":1}}
== new TransformStream() ==
{"objsPer":61,"heapBytesPer":2816,"perStream":{"Function":19,"Object":11.01,"JSLexicalEnvironment":9,"Array":3,"Promise":4,"ReadableStreamDefaultController":1,"ReadableStream":1,"WritableStreamDefaultController":1,"WritableStream":1,"TransformStreamDefaultController":1,"TransformStream":1}}
== new Response('x').body ==
{"objsPer":8,"heapBytesPer":411,"perStream":{"Function":1,"Object":2.01,"JSLexicalEnvironment":2,"ReadableStream":1,"BlobInternalReadableStreamSource":1}}
```
